# Simulacro de restauración y prueba de carga (objetivo 4)

Procedimiento del simulacro de NFR-18 (#126) y de la prueba de carga de NFR-13, NFR-14 y NFR-15 (#127). Los resultados van en `docs/evaluacion.md`. Se ejecutó el 24 y el 26 de noviembre de 2026; este procedimiento ya incluye lo que se aprendió en esas dos sesiones.

| Archivo | Para qué |
|---|---|
| `db-url.mjs` | Arma, en memoria, la URL de otra instancia de RDS a partir de la de la API o la de las migraciones. |
| `verify-restore.sql` | Compara datos, esquema y ajustes de dos bases (solo lectura). |
| `seed-history.sql` | Carga 100.000 estadías sintéticas, solo en la instancia restaurada. |
| `common.js` | Sesiones de los operadores de carga (k6). |
| `entry-exit.js` | Ingresos y salidas: calentamiento, E1, E3 y ráfaga (k6). |
| `history.js` | Historial con filtros: E2 (k6). |

## Ambiente

- **La prueba nunca toca producción.** La base es una instancia nueva, `parkapp-db-simulacro`, restaurada de `parkapp-db` a un punto en el tiempo, con la misma clase, motor, disco, grupo de parámetros, CA y zona (us-east-1a). La API de prueba es un segundo proceso de la versión activa, como `parkapp`, en `127.0.0.1:3001`, conectado a esa instancia. No cambian `parkapp-api`, `start.sh`, Nginx, los parámetros de `/parkapp/prod/` ni `parkapp-db`. Las estadías sintéticas, los ingresos y salidas de carga y su consecutivo desaparecen al borrar la instancia.
- **k6 corre en el servidor** contra `127.0.0.1:3001`: mide el tiempo de la API, Prisma y RDS, sin internet ni TLS. Comparte la CPU de la t4g.micro con las dos API, así que los resultados son pesimistas. La latencia de red desde Bogotá se mide aparte (paso 4.7).
- **Durante la sesión** no se usa producción (las comparaciones de los pasos 3.3, 4.2 y 4.6 deben dar igual) ni se fusionan PR (un despliegue cambia `/opt/parkapp/current`).
- **Antes del #50:** con el límite de NFR-08 (100 peticiones por minuto por IP), 20 usuarios desde una sola IP recibirían 429.
- **Cupo del plan gratuito:** la cuenta admite 2 instancias de RDS, `parkapp-db` y una restaurada. Por eso la restauración desde AWS Backup va después de borrar la primera (paso 5.4), no en paralelo. En un incidente pasa lo mismo: si una restauración sale mal, hay que borrarla antes de intentar otra.
- **Repositorio público:** ningún comando imprime el número de cuenta, ARN, ID de recursos, endpoints ni IP. En las capturas que vayan a algo público se tapan la cuenta, la línea del servidor de RDS, el Session ID, el Instance ID, el correo y cualquier contraseña o URL de conexión.
- **Costo:** unos USD 0,02 por hora por instancia temporal. La acción de Budgets **no la detiene** (su política solo cubre `parkapp-servidor` y `parkapp-db`): se borra apenas termina la prueba (paso 5). En noviembre de 2026, la primera restaurada vivió unas 38 horas, entre las dos sesiones.

### Terminales

Cada paso dice si va en **CloudShell** (indicador `~ $`) o en el **servidor** (Session Manager, `bash`, indicador `[ssm-user@... ]$`), un comando a la vez. Los comandos `aws rds` en el servidor responden `AccessDenied`: el rol del servidor no tiene permisos de RDS (mínimo privilegio). Para anotar la hora de Bogotá en cualquiera de los dos:

```bash
hora() { TZ=America/Bogota date '+%F %T'; }
```

- **CloudShell y Session Manager cierran la sesión tras unos 20 minutos sin teclear, aunque haya un comando corriendo**, y con ella se pierden las variables. Por eso ningún paso espera una restauración con `aws rds wait`: se revisa el estado cada tanto, y los tiempos salen de los eventos de RDS (paso 3.5). Al reconectar se vuelven a definir: en CloudShell, `hora`, `CUENTA` e `INST` (paso 1) y `SG_DB` (paso 3.1); en el servidor, `hora`, las URL del paso 3.3 (y las del 4.1 si hacen falta), y `RP_ADMIN_CORREO` y `RP_ADMIN_CLAVE` (paso 3.4). La API de prueba sigue corriendo.
- **Antes de pegar, el indicador debe estar vacío.** Una línea que quedó sin Enter se une con la siguiente que se pegue: el 26 de noviembre así se perdió un `delete-db-instance` (`syntax error near unexpected token '('`), y la espera que seguía quedó mirando una instancia viva. Las esperas se encadenan con `&&`, para que un Ctrl + C no imprima un mensaje falso, y después de cada borrado se comprueba el estado con `describe-db-instances`.

## 1. Antes de empezar (CloudShell)

```bash
CUENTA="$(aws sts get-caller-identity --query Account --output text)"
aws budgets describe-budget --account-id "$CUENTA" --budget-name parkapp-mensual --query 'Budget.{Gastado:CalculatedSpend.ActualSpend.Amount,Limite:BudgetLimit.Amount}' --output table
INST="$(aws ec2 describe-instances --filters Name=tag:Name,Values=parkapp-servidor --query 'Reservations[0].Instances[0].InstanceId' --output text)"
aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUCreditBalance --dimensions Name=InstanceId,Value="$INST" --start-time "$(date -u -d '-1 hour' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" --period 300 --statistics Average --query 'sort_by(Datapoints,&Timestamp)[-1].Average' --output text
aws backup list-backup-jobs --by-backup-vault-name parkapp-respaldos --query 'sort_by(BackupJobs,&CreationDate)[-7:].{Estado:State,Inicio:CreationDate}' --output table
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text
```

Se sigue si el gasto proyectado del mes queda por debajo de USD 28, el saldo de créditos de CPU es de 100 o más (el máximo de una t4g.micro es 288) y la única instancia de RDS es `parkapp-db`.

## 2. Instrumentos en el servidor (servidor)

`C` es el commit de `main` que tiene esta carpeta; los SHA-256 están en el PR que la agregó o la cambió por última vez.

```bash
C=<commit>
mkdir -p /tmp/rp-carga && cd /tmp/rp-carga
for f in README.md common.js db-url.mjs entry-exit.js history.js seed-history.sql verify-restore.sql; do curl -sSf -o "$f" "https://raw.githubusercontent.com/wrafael91/parkapp/$C/infra/load-test/$f"; done
sha256sum *
```

## 3. Simulacro de restauración (#126)

### 3.1 Restaurar a un punto en el tiempo (CloudShell)

El punto pedido es una hora fija de hace 5 minutos. Si queda después de la última hora restaurable (RDS la publica con unos minutos de atraso), se usa la última restaurable redondeada al minuto hacia abajo:

```bash
hora() { TZ=America/Bogota date '+%F %T'; }
SG_DB="$(aws ec2 describe-security-groups --filters Name=group-name,Values=parkapp-db --query 'SecurityGroups[0].GroupId' --output text)"
ULTIMA="$(aws rds describe-db-instances --db-instance-identifier parkapp-db --query 'DBInstances[0].LatestRestorableTime' --output text)"; echo "Última restaurable (UTC): $ULTIMA"
HORA="$(date -u -d '-5 minutes' +%Y-%m-%dT%H:%M:00Z)"
[ "$(date -u -d "$HORA" +%s)" -gt "$(date -u -d "$ULTIMA" +%s)" ] && HORA="$(date -u -d "$ULTIMA" +%Y-%m-%dT%H:%M:00Z)"; echo "Punto pedido (UTC): $HORA"
echo "T0, inicio: $(hora)"
aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier parkapp-db --target-db-instance-identifier parkapp-db-simulacro --restore-time "$HORA" --db-instance-class db.t4g.micro --availability-zone us-east-1a --db-subnet-group-name parkapp-db-subredes --vpc-security-group-ids "$SG_DB" --db-parameter-group-name parkapp-postgres16 --ca-certificate-identifier rds-ca-rsa2048-g1 --no-publicly-accessible --no-multi-az --backup-retention-period 0 --no-deletion-protection --tags Key=Proyecto,Value=parkapp Key=Temporal,Value=objetivo4 --query 'DBInstance.DBInstanceStatus' --output text
```

Debe responder `creating`. La restauración tarda unos 10 minutos. Se revisa cada tanto, sin `aws rds wait`, hasta que diga `available`:

```bash
aws rds describe-db-instances --db-instance-identifier parkapp-db-simulacro --query 'DBInstances[0].DBInstanceStatus' --output text
```

### 3.2 Configuración (CloudShell)

```bash
for DB in parkapp-db parkapp-db-simulacro; do aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].{Instancia:DBInstanceIdentifier,Estado:DBInstanceStatus,Clase:DBInstanceClass,Motor:EngineVersion,Zona:AvailabilityZone,Disco:StorageType,GB:AllocatedStorage,Cifrado:StorageEncrypted,Publica:PubliclyAccessible,MultiAZ:MultiAZ,Parametros:DBParameterGroups[0].DBParameterGroupName,Subredes:DBSubnetGroup.DBSubnetGroupName,CA:CACertificateIdentifier,Retencion:BackupRetentionPeriod,ProteccionBorrado:DeletionProtection}' --output table; done
aws ec2 describe-security-groups --group-ids $(aws rds describe-db-instances --db-instance-identifier parkapp-db-simulacro --query 'DBInstances[0].VpcSecurityGroups[].VpcSecurityGroupId' --output text) --query 'SecurityGroups[].GroupName' --output text
aws rds describe-db-parameters --db-parameter-group-name parkapp-postgres16 --query "Parameters[?ParameterName=='rds.force_ssl'].[ParameterName,ParameterValue]" --output text
echo "T2, configuración revisada: $(hora)"
```

La restaurada debe coincidir con `parkapp-db` en clase, motor, zona, disco, cifrado, parámetros, subredes y CA, sin acceso público, con retención 0, sin protección contra borrado y con el grupo `parkapp-db`. La última consulta debe mostrar `rds.force_ssl 1`.

### 3.3 Datos completos (servidor)

Las URL se arman en memoria y nunca se imprimen (ADR 0006):

```bash
cd /tmp/rp-carga
RP_DB="$(aws ssm get-parameter --name /parkapp/prod/db/url-app --with-decryption --query Parameter.Value --output text --region us-east-1)"
RP_PSQL_PROD="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db psql)"
RP_PSQL_SIM="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db-simulacro psql)"
psql "$RP_PSQL_PROD" -X -q -At -f verify-restore.sql > prod.txt
psql "$RP_PSQL_SIM" -X -q -At -f verify-restore.sql > sim.txt
diff prod.txt sim.txt && echo "IGUALES"
cat sim.txt
```

La salida no tiene secretos (conteos, huellas md5 y ajustes). `sim.txt` debe ser igual a `prod.txt`. La línea `rds.force_ssl` dice `no visible para este rol` en las dos, porque `parkapp_app` no puede leer ese parámetro; su valor se comprobó en el paso 3.2, y la línea `tls` muestra la versión de TLS de la conexión.

### 3.4 La aplicación sobre la restaurada (servidor)

```bash
hora() { TZ=America/Bogota date '+%F %T'; }
RP_DB_SIM="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db-simulacro)"
export DATABASE_URL="$RP_DB_SIM" PORT=3001 NODE_ENV=production
sudo --preserve-env=DATABASE_URL,PORT,NODE_ENV -u parkapp bash -c "cd /tmp && setsid -f node /opt/parkapp/current/dist/server.js > /tmp/rp-api-carga.log 2>&1 < /dev/null"
unset DATABASE_URL PORT NODE_ENV
curl -s -m 5 http://127.0.0.1:3001/api/salud; echo; cat /tmp/rp-api-carga.log
```

Debe responder `{"estado":"ok"}` y el registro solo dice `ParkApp API listening on http://127.0.0.1:3001`.

Cuenta de carga, solo en la restaurada (contraseña de 15 a 64 caracteres, sin tildes, comillas ni barras, escrita a ciegas). Si la sesión se cierra, se vuelve a escribir con el primer `read` y el `export`, sin correr otra vez `create-admin.js`:

```bash
read -rs -p "Contraseña de carga: " RP_ADMIN_CLAVE; echo
export RP_ADMIN_CLAVE RP_ADMIN_CORREO=carga@rolopark.test
printf '%s' "$RP_ADMIN_CLAVE" | DATABASE_URL="$RP_DB_SIM" node /opt/parkapp/current/dist/scripts/create-admin.js "$RP_ADMIN_CORREO" "Administrador de carga"
```

El historial de la API de prueba muestra las estadías de prueba de producción:

```bash
RP_COOKIE="$(printf '{"correo":"%s","contrasena":"%s"}' "$RP_ADMIN_CORREO" "$RP_ADMIN_CLAVE" | curl -s -m 10 -o /dev/null -D - -H 'Origin: https://rolopark.com' -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3001/api/sesion | sed -nE 's/^[Ss]et-[Cc]ookie: sesion=([^;]+).*/\1/p')"
curl -s -m 10 -H "Cookie: sesion=$RP_COOKIE" "http://127.0.0.1:3001/api/estadias?placa=TST" | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(d.estadias.length + " estadías: " + d.estadias.map((e) => e.placa + " " + e.estado).join(", "))'
unset RP_COOKIE
echo "T3, la aplicación responde: $(hora)"
```

### 3.5 Tiempos (CloudShell)

```bash
aws rds describe-events --source-type db-instance --source-identifier parkapp-db-simulacro --duration 240 --query 'Events[].[Date,Message]' --output table
aws rds describe-db-instances --db-instance-identifier parkapp-db-simulacro --query 'DBInstances[0].InstanceCreateTime' --output text
```

Las horas de los eventos están en UTC. T1 (disponible) es el evento `DB instance restarted` que sigue a `Restored from DB instance parkapp-db to ...`. RDS no registra un evento al aceptar la petición: T0 es el `echo` del paso 3.1.

Tiempo total = T3 − T0 (meta: menos de 2 horas). RPO = el punto pedido frente a la hora real del paso 3.1: es lo que se perdería en un incidente. El corte con el renombre se mide al final (paso 5.2) y la restauración desde AWS Backup, en el paso 5.4.

## 4. Prueba de carga (#127)

### 4.1 Semilla (servidor)

La semilla corre como `parkapp_migrator`, el dueño de las tablas: la base no concede permisos a PUBLIC (`docs/arquitectura.md`, 6.5), así que `parkapp_app` no puede crear la tabla temporal que usa (`permission denied to create temporary tables`), ni correr `ANALYZE`. Su URL también vive solo en memoria:

```bash
cd /tmp/rp-carga
RP_DB_MIG="$(aws ssm get-parameter --name /parkapp/prod/db/url-migrator --with-decryption --query Parameter.Value --output text --region us-east-1)"
RP_PSQL_SIM_MIG="$(RP_DB="$RP_DB_MIG" node db-url.mjs parkapp-db-simulacro psql)"
psql "$RP_PSQL_SIM_MIG" -X -At -c "SELECT current_user, (SELECT count(*) FROM estadia), (SELECT count(*) FROM usuario WHERE correo = 'carga@rolopark.test')"
```

Antes de seguir, esa línea debe decir `parkapp_migrator|<estadías de producción>|1`: la cuenta de carga solo existe en la restaurada. El script también se niega a correr si falta esa cuenta, si el rol no es `parkapp_migrator`, sin `-v ambiente=simulacro` o con más de 1.000 estadías. Carga todo en una transacción y termina con `ANALYZE`:

```bash
psql "$RP_PSQL_SIM_MIG" -X -v ambiente=simulacro -f seed-history.sql
unset RP_DB_MIG RP_PSQL_SIM_MIG
```

### 4.2 Producción antes (servidor, solo lectura)

```bash
psql "$RP_PSQL_PROD" -X -q -At -f verify-restore.sql > prod-antes.txt
diff prod.txt prod-antes.txt && echo "IGUALES"
```

Debe ser igual a `prod.txt` del paso 3.3. Si la prueba sigue otro día, se compara con el `prod.txt` de la sesión anterior (sigue en `/tmp/rp-carga` si el servidor no se reinició): así se prueba también que producción no cambió entre las dos sesiones.

### 4.3 k6 (servidor)

```bash
mkdir -p /tmp/rp-k6 && cd /tmp/rp-k6
curl -sSfLO https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-linux-arm64.tar.gz
echo "7bb415f59d81ad649a86f6da6b3e1bd2e4e64e84909deef13e9bca70608abccb  k6-v2.4.0-linux-arm64.tar.gz" | sha256sum -c
tar -xzf k6-v2.4.0-linux-arm64.tar.gz --strip-components=1 && ./k6 version
```

El SHA-256 es el del `k6-v2.4.0-checksums.txt` del release.

### 4.4 Corridas (servidor)

Antes de la primera corrida, `INICIO="$(date -u +%FT%TZ)"; echo "$INICIO"`, y antes de cada una, `echo "Inicio: $(hora)"`. Con `-q`, k6 no muestra nada mientras corre: E1 tarda unos 10 minutos y E2 unos 5, menos que los 20 minutos tras los que se cierra la sesión. k6 termina con el código 99 cuando no se cumple un umbral; en E3 y en la ráfaga, que son informativas, eso se reporta tal cual.

```bash
cd /tmp/rp-carga
/tmp/rp-k6/k6 run -q --summary-mode full -e ESCENARIO=calentamiento entry-exit.js > calentamiento.txt 2>&1; echo "salida=$?"
/tmp/rp-k6/k6 run -q --summary-mode full -e ESCENARIO=e1 --summary-export e1.json entry-exit.js > e1.txt 2>&1; echo "salida=$?"
/tmp/rp-k6/k6 run -q --summary-mode full --summary-export e2.json history.js > e2.txt 2>&1; echo "salida=$?"
/tmp/rp-k6/k6 run -q --summary-mode full -e ESCENARIO=e3 --summary-export e3.json entry-exit.js > e3.txt 2>&1; echo "salida=$?"
/tmp/rp-k6/k6 run -q --summary-mode full -e ESCENARIO=rafaga --summary-export rafaga.json entry-exit.js > rafaga.txt 2>&1; echo "salida=$?"
```

Después de la última, `FIN="$(date -u +%FT%TZ)"; echo "$FIN"`. Resumen de cada corrida (sin secretos: la dirección es `127.0.0.1`):

```bash
for f in e1 e2 e3 rafaga; do echo "== $f"; grep -E "✓|✗|operacion:|filtro:|fase:carga|iterations\.\.|level=error" "$f.txt" | sort -u; done
```

### 4.5 Contexto (CloudShell)

`INICIO` y `FIN` van en UTC y con su fecha completa, tal como los imprimió el servidor (por ejemplo, `2026-11-25T03:38:29Z`): a las 22:38 del 24 de noviembre en Bogotá, en UTC ya es el 25. En los documentos, la hora UTC siempre va con su fecha UTC.

```bash
INICIO=<inicio-utc>; FIN=<fin-utc>
aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --dimensions Name=InstanceId,Value="$INST" --start-time "$INICIO" --end-time "$FIN" --period 300 --statistics Average Maximum --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Average,Maximum]' --output table
aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUCreditBalance --dimensions Name=InstanceId,Value="$INST" --start-time "$INICIO" --end-time "$FIN" --period 300 --statistics Minimum --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Minimum]' --output table
for M in CPUUtilization DatabaseConnections; do aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name "$M" --dimensions Name=DBInstanceIdentifier,Value=parkapp-db-simulacro --start-time "$INICIO" --end-time "$FIN" --period 60 --statistics Maximum --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Maximum]' --output table; done
```

La CPU de la EC2 llega en promedios de 5 minutos (monitoreo básico) y no muestra picos de segundos: para eso están los percentiles de k6.

### 4.6 Producción después (servidor, solo lectura)

```bash
psql "$RP_PSQL_PROD" -X -q -At -f verify-restore.sql > prod-despues.txt
diff prod-antes.txt prod-despues.txt && echo "IGUALES"
```

### 4.7 Red desde Bogotá (PC, PowerShell, solo lectura)

```powershell
cd C:\Users\Rafael\Documents\programacion\trabajodegrado\parkapp
$muestras = 1..100 | ForEach-Object { curl.exe -s -o NUL -w "%{time_appconnect} %{time_starttransfer} %{time_total}" https://rolopark.com/api/salud; Start-Sleep -Milliseconds 500 }
$peticion = $muestras | ForEach-Object { $p = $_ -split ' '; ([double]$p[1] - [double]$p[0]) * 1000 } | Sort-Object
$total = $muestras | ForEach-Object { [double](($_ -split ' ')[2]) * 1000 } | Sort-Object
"Peticion sobre una conexion abierta: mediana {0:N0} ms, p95 {1:N0} ms" -f $peticion[49], $peticion[94]
"Con conexion y TLS nuevos: mediana {0:N0} ms, p95 {1:N0} ms" -f $total[49], $total[94]
```

La primera línea es lo que la red suma a cada petición de una página ya abierta (un viaje de ida y vuelta).

## 5. Corte, segunda restauración y limpieza

### 5.1 Detener la API de prueba (servidor)

Se detiene por el puerto 3001: un `pkill` por nombre detendría también la de producción, que tiene el mismo comando.

```bash
RP_PID="$(sudo ss -Hltnp 'sport = :3001' | sed -nE 's/.*pid=([0-9]+).*/\1/p')"; ps -o user,pid,args -p "$RP_PID"
sudo kill "$RP_PID"
curl -s -m 5 http://127.0.0.1:3001/api/salud || echo "API de prueba detenida"
systemctl is-active parkapp-api && curl -s -m 5 http://127.0.0.1:3000/api/salud; echo
```

### 5.2 Corte con el renombre (CloudShell y servidor)

En un incidente real, la instancia dañada se renombra y la restaurada toma el nombre `parkapp-db`: conserva el endpoint y el ARN, así que no cambian los parámetros de `/parkapp/prod/`, ni la acción de Budgets ni la selección de AWS Backup, que están atadas al ARN. Al final se reinicia la API (`sudo systemctl restart parkapp-api`) para que no queden conexiones a la instancia vieja. Aquí se mide el renombre en la propia restaurada (CloudShell):

```bash
echo "Renombre, inicio: $(hora)"
aws rds modify-db-instance --db-instance-identifier parkapp-db-simulacro --new-db-instance-identifier parkapp-db-simulacro2 --apply-immediately --query 'DBInstance.DBInstanceStatus' --output text
until [ "$(aws rds describe-db-instances --db-instance-identifier parkapp-db-simulacro2 --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null)" = available ]; do sleep 15; done && echo "Renombrada y disponible: $(hora)"
```

El `modify` responde `available` porque muestra el estado anterior. El renombre no reinicia la instancia. Y en el servidor, hasta que el nombre nuevo acepta conexiones (el DNS del nombre nuevo tarda un par de minutos más):

```bash
until psql "$(RP_DB="$RP_DB" node /tmp/rp-carga/db-url.mjs parkapp-db-simulacro2 psql)" -X -At -c 'SELECT 1' > /dev/null 2>&1; do sleep 10; done && echo "Conexión con el nombre nuevo: $(hora)"
```

### 5.3 Borrar la restaurada (CloudShell)

```bash
aws rds delete-db-instance --db-instance-identifier parkapp-db-simulacro2 --skip-final-snapshot --delete-automated-backups --query 'DBInstance.DBInstanceStatus' --output text
aws rds describe-db-instances --db-instance-identifier parkapp-db-simulacro2 --query 'DBInstances[0].DBInstanceStatus' --output text
aws rds wait db-instance-deleted --db-instance-identifier parkapp-db-simulacro2 && echo "Borrada: $(hora)"
```

Las dos primeras deben decir `deleting`; si la segunda dice `available`, el borrado no se lanzó y se repite. El borrado tarda unos 4 minutos.

### 5.4 Restaurar desde AWS Backup (CloudShell y servidor)

Criterio 7 de #126, con la instantánea más reciente del plan `parkapp-diario`. RDS acepta el punto de recuperación de AWS Backup con el administrador, sin crear un rol de restauración (26 de noviembre de 2026). Su ARN queda en una variable (CloudShell):

```bash
RP_PUNTO="$(aws backup list-recovery-points-by-backup-vault --backup-vault-name parkapp-respaldos --query 'sort_by(RecoveryPoints[?Status==`COMPLETED`],&CreationDate)[-1].RecoveryPointArn' --output text)"
aws backup list-recovery-points-by-backup-vault --backup-vault-name parkapp-respaldos --query 'sort_by(RecoveryPoints[?Status==`COMPLETED`],&CreationDate)[-1].CreationDate' --output text
echo "T0 de AWS Backup: $(hora)"
aws rds restore-db-instance-from-db-snapshot --db-snapshot-identifier "$RP_PUNTO" --db-instance-identifier parkapp-db-simulacro-ab --db-instance-class db.t4g.micro --availability-zone us-east-1a --db-subnet-group-name parkapp-db-subredes --vpc-security-group-ids "$SG_DB" --db-parameter-group-name parkapp-postgres16 --ca-certificate-identifier rds-ca-rsa2048-g1 --no-publicly-accessible --no-multi-az --backup-retention-period 0 --no-deletion-protection --tags Key=Proyecto,Value=parkapp Key=Temporal,Value=objetivo4 --query 'DBInstance.DBInstanceStatus' --output text
aws rds describe-db-instances --db-instance-identifier parkapp-db-simulacro-ab --query 'DBInstances[0].DBInstanceStatus' --output text
```

Si RDS rechaza la instantánea, no se crea un rol de restauración: se anota el mensaje y se sigue con el paso 5.5. Cuando la última consulta diga `available` (unos 6 minutos), se revisan la configuración con los comandos del paso 3.2 (cambiando `parkapp-db-simulacro` por `parkapp-db-simulacro-ab`) y los eventos:

```bash
aws rds describe-events --source-type db-instance --source-identifier parkapp-db-simulacro-ab --duration 60 --query 'Events[].[Date,Message]' --output table
```

T1 es el último `DB instance restarted`, después de `Finished updating DB parameter group`. El evento `Restored from snapshot` trae el identificador del trabajo de AWS Backup: no va en capturas ni documentos públicos.

Datos (servidor, con `RP_DB` y `prod.txt` del paso 3.3):

```bash
cd /tmp/rp-carga
RP_PSQL_AB="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db-simulacro-ab psql)"
psql "$RP_PSQL_AB" -X -q -At -f verify-restore.sql > ab.txt
diff prod.txt ab.txt && echo "IGUALES"
```

Las tablas pueden diferir solo si producción cambió después de la hora de la instantánea; en ese caso, la diferencia se explica con las filas nuevas. Después se borra igual que en el paso 5.3 (CloudShell):

```bash
aws rds delete-db-instance --db-instance-identifier parkapp-db-simulacro-ab --skip-final-snapshot --delete-automated-backups --query 'DBInstance.DBInstanceStatus' --output text
aws rds describe-db-instances --db-instance-identifier parkapp-db-simulacro-ab --query 'DBInstances[0].DBInstanceStatus' --output text
aws rds wait db-instance-deleted --db-instance-identifier parkapp-db-simulacro-ab && echo "Borrada: $(hora)"
```

### 5.5 Comprobación final (CloudShell)

```bash
aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus]' --output text
aws rds describe-db-snapshots --snapshot-type manual --query "DBSnapshots[?starts_with(DBSnapshotIdentifier, 'parkapp-db-simulacro')].DBSnapshotIdentifier" --output text
aws rds describe-db-instance-automated-backups --query "DBInstanceAutomatedBackups[?starts_with(DBInstanceIdentifier, 'parkapp-db-simulacro')].DBInstanceIdentifier" --output text
unset RP_PUNTO SG_DB
```

Debe quedar solo `parkapp-db available`, y las otras dos consultas no devuelven nada.

### 5.6 Limpiar el servidor (servidor)

El registro de la API de prueba lo creó el usuario `parkapp`, así que se borra con `sudo`:

```bash
rm -rf /tmp/rp-carga /tmp/rp-k6
sudo rm -f /tmp/rp-api-carga.log
unset RP_DB RP_PSQL_PROD RP_PSQL_SIM RP_PSQL_AB RP_DB_SIM RP_ADMIN_CLAVE RP_ADMIN_CORREO RP_PID INICIO FIN
sudo ss -Hltn | grep -E ':300[01] '
systemctl is-active parkapp-api && curl -s -m 5 http://127.0.0.1:3000/api/salud; echo
```

Solo debe escuchar el 3000, y `parkapp-api` debe seguir `active` con `{"estado":"ok"}`.
