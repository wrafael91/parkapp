// The user of the session as the API answers it (ADR 0008).
type Usuario = {
  nombre: string;
  rol: "ADMINISTRADOR" | "OPERADOR";
  debeCambiarContrasena: boolean;
};

export default function ChangePassword(_props: {
  mandatory?: boolean;
  onChanged: (user: Usuario) => void;
  onSessionEnded: () => void;
}) {
  return null;
}
