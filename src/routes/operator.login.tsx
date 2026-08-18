import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { errorMessage } from "@/lib/error-message";
import { operatorLoginFn, operatorRouteStatusFn } from "@/lib/operator/operator-auth.functions";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";

export const Route = createFileRoute("/operator/login")({
  beforeLoad: async () => {
    // Родительский /operator уже отсёк "не тот деплой" — здесь остаётся
    // решить только между "уже вошёл" (на дашборд) и "показать форму".
    const { status } = await operatorRouteStatusFn();
    if (status === "authenticated") throw redirect({ to: "/operator" });
  },
  head: () => ({ meta: [{ title: "Вход — панель оператора" }] }),
  component: OperatorLoginPage,
});

function OperatorLoginPage() {
  const router = useRouter();
  const login = useServerFn(operatorLoginFn);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login({ data: { username, password } });
      if (res.ok) {
        await router.navigate({ to: "/operator" });
      } else {
        setError("Неверный логин или пароль");
      }
    } catch (err: unknown) {
      setError(errorMessage(err) || "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-card border rounded-lg shadow-sm p-6 space-y-4"
      >
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Панель оператора</h1>
          <p className="text-sm text-muted-foreground">Не связана со входом в админку клиентов</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Логин</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Пароль</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Вход..." : "Войти"}
        </Button>
      </form>
    </div>
  );
}
