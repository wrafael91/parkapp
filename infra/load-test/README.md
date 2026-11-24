# Simulacro de restauración y prueba de carga (objetivo 4)

Procedimiento del simulacro de NFR-18 (#126) y de la prueba de carga de NFR-13, NFR-14 y NFR-15 (#127). Los resultados van en `docs/evaluacion.md`.

| Archivo | Para qué |
|---|---|
| `db-url.mjs` | Arma, en memoria, la URL de otra instancia de RDS a partir de la de la API. |
| `verify-restore.sql` | Compara datos, esquema y ajustes de dos bases (solo lectura). |
| `seed-history.sql` | Carga 100.000 estadías sintéticas, solo en la instancia restaurada. |
| `common.js` | Sesiones de los operadores de carga (k6). |
| `entry-exit.js` | Ingresos y salidas: calentamiento, E1, E3 y ráfaga (k6). |
| `history.js` | Historial con filtros: E2 (k6). |

## Ambiente

- **La prueba nunca toca producción.** La base es una instancia nueva, `parkapp-db-simulacro`, restaurada de `parkapp-db` a un punto en el tiempo, con la misma clase, motor, disco, grupo de parámetros, CA y zona (us-east-1a). La API de prueba es un segundo proceso de la versión activa, como `parkapp`, en `127.0.0.1:3001`, conectado a esa instancia. No cambian `parkapp-api`, `start.sh`, Nginx, los parámetros de `/parkapp/prod/` ni `parkapp-db`. Las estadías sintéticas, los ingresos y salidas de carga y su consecutivo desaparecen al borrar la instancia.
- **k6 corre en el servidor** contra `127.0.0.1:3001`: mide el tiempo de la API, Prisma y RDS, sin internet ni TLS. Comparte la CPU de la t4g.micro con las dos API, así que los resultados son pesimistas. La latencia de red desde Bogotá se mide aparte (paso 4.7).
- **Durante la sesión** no se usa producción (la comparación del paso 3.3 debe dar igual) ni se fusionan PR (un despliegue cambia `/opt/parkapp/current`).
- **Antes del #50:** con el límite de NFR-08 (100 peticiones por minuto por IP), 20 usuarios desde una sola IP recibirían 429.
- **Repositorio público:** ningún comando imprime el número de cuenta, ARN, ID de recursos, endpoints ni IP. En las capturas que vayan a algo público se tapan la cuenta, la línea del servidor de RDS y cualquier contraseña o URL de conexión.
- **Costo:** unos USD 0,02 por hora por instancia temporal. La acción de Budgets **no la detiene** (su política solo cubre `parkapp-servidor` y `parkapp-db`): se borra el mismo día (paso 5).

Cada paso dice si va en **CloudShell** o en el **servidor** (Session Manager, `bash`, un comando a la vez). Para anotar la hora de Bogotá en cualquiera de los dos:

```bash
hora() { TZ=America/Bogota date '+%F %T'; }
```

CloudShell y Session Manager cierran la sesión tras 20 minutos sin actividad, y con ella se pierden las variables. Si pasa, se vuelven a definir: en CloudShell, `hora`, `CUENTA` e `INST` (paso 1) y `SG_DB` (paso 3.1); en el servidor, `hora` y las URL del paso 3.3, y `RP_ADMIN_CORREO` y `RP_ADMIN_CLAVE` (paso 3.4). La API de prueba sigue corriendo.

## 1. Antes de empezar (CloudShell)

```bash
CUENTA="$(aws sts get-caller-identity --query Account --output text)"
aws budgets describe-budget --account-id "$CUENTA" --budget-name parkapp-mensual --query 'Budget.{Gastado:CalculatedSpend.ActualSpend.Amount,Limite:BudgetLimit.Amount}' --output table
INST="$(aws ec2 describe-instances --filters Name=tag:Name,Values=parkapp-servidor --query 'Reservations[0].Instances[0].InstanceId' --output text)"
aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUCreditBalance --dimensions Name=InstanceId,Value="$INST" --start-time "$(date -u -d '-1 hour' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" --period 300 --statistics Average --query 'sort_by(Datapoints,&Timestamp)[-1].Average' --output text
aws backup list-backup-jobs --by-backup-vault-name parkapp-respaldos --query 'sort_by(BackupJobs,&CreationDate)[-7:].{Estado:State,Inicio:CreationDate}' --output table
```

Se sigue si el gasto proyectado del mes queda por debajo de USD 28 y el saldo de créditos de CPU es de 100 o más (el máximo de una t4g.micro es 288).

## 2. Instrumentos en el servidor (servidor)

`C` es el commit de `main` que tiene esta carpeta; los SHA-256 están en el PR que la agregó.

```bash
C=<commit>
mkdir -p /tmp/rp-carga && cd /tmp/rp-carga
for f in README.md common.js db-url.mjs entry-exit.js history.js seed-history.sql verify-restore.sql; do curl -sSf -o "$f" "https://raw.githubusercontent.com/wrafael91/parkapp/$C/infra/load-test/$f"; done
sha256sum *
```

## 3. Simulacro de restauración (#126)

### 3.1 Restaurar (CloudShell)

```bash
hora() { TZ=America/Bogota date '+%F %T'; }
SG_DB="$(aws ec2 describe-security-groups --filters Name=group-name,Values=parkapp-db --query 'SecurityGroups[0].GroupId' --output text)"
aws rds describe-db-instances --db-instance-identifier parkapp-db --query 'DBInstances[0].LatestRestorableTime' --output text
HORA="$(date -u -d '-5 minutes' +%Y-%m-%dT%H:%M:00Z)"; echo "Punto pedido (UTC): $HORA"
echo "T0, inicio: $(hora)"
aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier parkapp-db --target-db-instance-identifier parkapp-db-simulacro --restore-time "$HORA" --db-instance-class db.t4g.micro --availability-zone us-east-1a --db-subnet-group-name parkapp-db-subredes --vpc-security-group-ids "$SG_DB" --db-parameter-group-name parkapp-postgres16 --ca-certificate-identifier rds-ca-rsa2048-g1 --no-publicly-accessible --no-multi-az --backup-retention-period 0 --no-deletion-protection --tags Key=Proyecto,Value=parkapp Key=Temporal,Value=objetivo4 --query 'DBInstance.DBInstanceStatus' --output text
```

Restauración desde AWS Backup, en paralelo (criterio 7). La instantánea es la más reciente del plan `parkapp-diario`; su ARN queda en una variable:

```bash
RP_PUNTO="$(aws backup list-recovery-points-by-backup-vault --backup-vault-name parkapp-respaldos --query 'sort_by(RecoveryPoints[?Status==`COMPLETED`],&CreationDate)[-1].RecoveryPointArn' --output text)"
aws backup list-recovery-points-by-backup-vault --backup-vault-name parkapp-respaldos --query 'sort_by(RecoveryPoints[?Status==`COMPLETED`],&CreationDate)[-1].CreationDate' --output text
echo "T0 de AWS Backup: $(hora)"
aws rds restore-db-instance-from-db-snapshot --db-snapshot-identifier "$RP_PUNTO" --db-instance-identifier parkapp-db-simulacro-ab --db-instance-class db.t4g.micro --availability-zone us-east-1a --db-subnet-group-name parkapp-db-subredes --vpc-security-group-ids "$SG_DB" --db-parameter-group-name parkapp-postgres16 --ca-certificate-identifier rds-ca-rsa2048-g1 --no-publicly-accessible --no-multi-az --backup-retention-period 0 --no-deletion-protection --tags Key=Proyecto,Value=parkapp Key=Temporal,Value=objetivo4 --query 'DBInstance.DBInstanceStatus' --output text
```

Si RDS rechaza la instantánea de AWS Backup, no se crea un rol de restauración: se anota el mensaje y se sigue con la otra.

```bash
aws rds wait db-instance-available --db-instance-identifier parkapp-db-simulacro; echo "T1, disponible: $(hora)"
aws rds wait db-instance-available --db-instance-identifier parkapp-db-simulacro-ab; echo "T1 de AWS Backup: $(hora)"
```

### 3.2 Configuración (CloudShell)

```bash
for DB in parkapp-db parkapp-db-simulacro parkapp-db-simulacro-ab; do aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].{Instancia:DBInstanceIdentifier,Estado:DBInstanceStatus,Clase:DBInstanceClass,Motor:EngineVersion,Zona:AvailabilityZone,Disco:StorageType,GB:AllocatedStorage,Cifrado:StorageEncrypted,Publica:PubliclyAccessible,MultiAZ:MultiAZ,Parametros:DBParameterGroups[0].DBParameterGroupName,Subredes:DBSubnetGroup.DBSubnetGroupName,CA:CACertificateIdentifier,Retencion:BackupRetentionPeriod,ProteccionBorrado:DeletionProtection}' --output table; done
for DB in parkapp-db-simulacro parkapp-db-simulacro-ab; do aws ec2 describe-security-groups --group-ids $(aws rds describe-db-instances --db-instance-identifier "$DB" --query 'DBInstances[0].VpcSecurityGroups[].VpcSecurityGroupId' --output text) --query 'SecurityGroups[].GroupName' --output text; done
echo "T2, configuración revisada: $(hora)"
```

Las dos restauradas deben coincidir con `parkapp-db` en clase, motor, zona, disco, cifrado, parámetros, subredes y CA, sin acceso público, con retención 0, sin protección contra borrado y con el grupo `parkapp-db`.

### 3.3 Datos completos (servidor)

Las URL se arman en memoria y nunca se imprimen (ADR 0006):

```bash
cd /tmp/rp-carga
RP_DB="$(aws ssm get-parameter --name /parkapp/prod/db/url-app --with-decryption --query Parameter.Value --output text --region us-east-1)"
RP_PSQL_PROD="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db psql)"
RP_PSQL_SIM="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db-simulacro psql)"
RP_PSQL_AB="$(RP_DB="$RP_DB" node db-url.mjs parkapp-db-simulacro-ab psql)"
psql "$RP_PSQL_PROD" -X -q -At -f verify-restore.sql > prod.txt
psql "$RP_PSQL_SIM" -X -q -At -f verify-restore.sql > sim.txt
diff prod.txt sim.txt && echo "IGUALES"
cat sim.txt
psql "$RP_PSQL_AB" -X -q -At -f verify-restore.sql > ab.txt
diff prod.txt ab.txt && echo "IGUALES"
```

La salida no tiene secretos (conteos, huellas md5 y ajustes). `sim.txt` debe ser igual a `prod.txt`. Para la de AWS Backup, las tablas pueden diferir solo si producción cambió después de las 4:30 a. m. de ese día; en ese caso, la diferencia se explica con las filas nuevas.

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

Cuenta de carga, solo en la restaurada (contraseña de 15 a 64 caracteres, sin tildes, comillas ni barras, escrita a ciegas):

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
for DB in parkapp-db-simulacro parkapp-db-simulacro-ab; do aws rds describe-events --source-type db-instance --source-identifier "$DB" --duration 240 --query 'Events[].[Date,Message]' --output table; done
aws rds describe-db-instances --db-instance-identifier parkapp-db --query 'DBInstances[0].LatestRestorableTime' --output text
```

Tiempo total = T3 − T0 (meta: menos de 2 horas). RPO = el punto pedido frente a la última hora restaurable del momento del simulacro. El corte con el renombre se mide al final (paso 5.2).

## 4. Prueba de carga (#127)

### 4.1 Semilla (servidor)

```bash
cd /tmp/rp-carga
psql "$RP_PSQL_SIM" -X -v ambiente=simulacro -f seed-history.sql
until [ "$(psql "$RP_PSQL_SIM" -X -At -c "SELECT n_mod_since_analyze < 1000 FROM pg_stat_user_tables WHERE relname = 'estadia'")" = t ]; do sleep 15; done; echo "Estadísticas al día: $(hora)"
```

`parkapp_app` no puede correr `ANALYZE` (no es dueño de las tablas): el ciclo espera a que autovacuum las analice, en uno o dos minutos.

### 4.2 Producción antes (servidor, solo lectura)

```bash
psql "$RP_PSQL_PROD" -X -At -c "SELECT 'estadias=' || count(*) || ' consecutivo=' || (SELECT coalesce(last_value::text, 'sin usar') FROM pg_sequences WHERE sequencename = 'comprobante_consecutivo_seq') FROM estadia"
```

### 4.3 k6 (servidor)

```bash
mkdir -p /tmp/rp-k6 && cd /tmp/rp-k6
curl -sSfLO https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-linux-arm64.tar.gz
echo "7bb415f59d81ad649a86f6da6b3e1bd2e4e64e84909deef13e9bca70608abccb  k6-v2.4.0-linux-arm64.tar.gz" | sha256sum -c
tar -xzf k6-v2.4.0-linux-arm64.tar.gz --strip-components=1 && ./k6 version
```

El SHA-256 es el del `k6-v2.4.0-checksums.txt` del release.

### 4.4 Corridas (servidor)

Antes de cada corrida, `echo "Inicio: $(hora)"`. Con `-q`, k6 no muestra nada mientras corre: E1 tarda unos 10 minutos y E2 unos 5. k6 termina con el código 99 cuando no se cumple un umbral; en E3 y en la ráfaga, que son informativas, eso se reporta tal cual.

```bash
cd /tmp/rp-carga
/tmp/rp-k6/k6 run -q --summary-mode full -e ESCENARIO=calentamiento entry-exit.js > calentamiento.txt 2>&1; echo "salida=$?"
/tmp/rp-k6/k6 run -q --summary-mode full -e ESCENARIO=e1 --summary-export e1.json entry-exit.js > e1.txt 2>&1; echo "salida=$?"
/tmp/rp-k6/k6 run -q --summary-mode full --summary-export e2.json history.js > e2.txt 2>&1; echo "salida=$?"
/tmp/rp-k6/k6 run -q --summary-mode full -e ESCENARIO=e3 --summary-export e3.json entry-exit.js > e3.txt 2>&1; echo "salida=$?"
/tmp/rp-k6/k6 run -q --summary-mode full -e ESCENARIO=rafaga --summary-export rafaga.json entry-exit.js > rafaga.txt 2>&1; echo "salida=$?"
```

Resumen de cada corrida (sin secretos: la dirección es `127.0.0.1`):

```bash
for f in e1 e2 e3 rafaga; do echo "== $f"; grep -E "✓|✗|operacion:|filtro:|fase:carga|iterations\.\.|level=error" "$f.txt" | sort -u; done
```

### 4.5 Contexto (CloudShell)

Con `INICIO` y `FIN` en UTC (`date -u +%FT%TZ` antes del calentamiento y después de la ráfaga):

```bash
aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --dimensions Name=InstanceId,Value="$INST" --start-time "$INICIO" --end-time "$FIN" --period 300 --statistics Average Maximum --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Average,Maximum]' --output table
aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUCreditBalance --dimensions Name=InstanceId,Value="$INST" --start-time "$INICIO" --end-time "$FIN" --period 300 --statistics Minimum --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Minimum]' --output table
for M in CPUUtilization DatabaseConnections; do aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name "$M" --dimensions Name=DBInstanceIdentifier,Value=parkapp-db-simulacro --start-time "$INICIO" --end-time "$FIN" --period 60 --statistics Maximum --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Maximum]' --output table; done
```

### 4.6 Producción después (servidor, solo lectura)

El mismo comando del paso 4.2: debe dar lo mismo.

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

## 5. Corte y limpieza (el mismo día)

### 5.1 Detener la API de prueba (servidor)

Se detiene por el puerto 3001: un `pkill` por nombre detendría también la de producción, que tiene el mismo comando.

```bash
RP_PID="$(sudo ss -Hltnp 'sport = :3001' | sed -nE 's/.*pid=([0-9]+).*/\1/p')"; ps -o user,pid,args -p "$RP_PID"
sudo kill "$RP_PID"
curl -s -m 5 http://127.0.0.1:3001/api/salud || echo "API de prueba detenida"
systemctl is-active parkapp-api && curl -s -m 5 http://127.0.0.1:3000/api/salud; echo
```

### 5.2 Corte con el renombre (CloudShell y servidor)

En un incidente real, la instancia dañada se renombra y la restaurada toma el nombre `parkapp-db`: conserva el endpoint y el ARN, así que no cambian los parámetros de `/parkapp/prod/`, ni la acción de Budgets ni la selección de AWS Backup, que están atadas al ARN. Aquí se mide el renombre en la propia restaurada (CloudShell):

```bash
echo "Renombre, inicio: $(hora)"
aws rds modify-db-instance --db-instance-identifier parkapp-db-simulacro --new-db-instance-identifier parkapp-db-simulacro2 --apply-immediately --query 'DBInstance.DBInstanceStatus' --output text
until [ "$(aws rds describe-db-instances --db-instance-identifier parkapp-db-simulacro2 --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null)" = available ]; do sleep 15; done; echo "Renombrada y disponible: $(hora)"
```

Y en el servidor, hasta que el nombre nuevo acepta conexiones:

```bash
until psql "$(RP_DB="$RP_DB" node /tmp/rp-carga/db-url.mjs parkapp-db-simulacro2 psql)" -X -At -c 'SELECT 1' > /dev/null 2>&1; do sleep 10; done; echo "Conexión con el nombre nuevo: $(hora)"
```

### 5.3 Borrar las instancias (CloudShell)

```bash
for DB in parkapp-db-simulacro2 parkapp-db-simulacro-ab; do aws rds delete-db-instance --db-instance-identifier "$DB" --skip-final-snapshot --delete-automated-backups --query 'DBInstance.DBInstanceStatus' --output text; done
for DB in parkapp-db-simulacro2 parkapp-db-simulacro-ab; do aws rds wait db-instance-deleted --db-instance-identifier "$DB"; done; echo "Borradas: $(hora)"
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text
aws rds describe-db-snapshots --snapshot-type manual --query "DBSnapshots[?starts_with(DBSnapshotIdentifier, 'parkapp-db-simulacro')].DBSnapshotIdentifier" --output text
unset RP_PUNTO
```

Debe quedar solo `parkapp-db`, y la última consulta no devuelve nada.

### 5.4 Limpiar el servidor (servidor)

```bash
rm -rf /tmp/rp-carga /tmp/rp-k6 /tmp/rp-api-carga.log
unset RP_DB RP_PSQL_PROD RP_PSQL_SIM RP_PSQL_AB RP_DB_SIM RP_ADMIN_CLAVE RP_ADMIN_CORREO RP_PID
```
