import { createFileRoute, useRouter, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { adminLogin } from "@/lib/admin.functions";
import { errorMessage } from "@/lib/error-message";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { localeNames, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  // Панель оператора — не магазин: у неё нет арендатора, и эта страница
  // работала бы под service_role. См. lib/control-plane.server.ts.
  beforeLoad: ({ context }) => {
    if (context.isPanel) throw notFound();
  },
  head: () => ({ meta: [{ title: "Вход в админ-панель" }] }),
  component: LoginPage,
});

// Небольшой самодостаточный словарь для страницы входа: она рендерится до
// аутентификации, поэтому AdminLocaleContext (см. src/routes/admin.tsx) тут
// недоступен. Используем тот же ключ localStorage["admin-locale"], что и
// панель — так выбор языка на логине сразу подхватывается в самой панели.
const copy: Record<
  Locale,
  {
    title: string;
    subtitle: string;
    username: string;
    password: string;
    loggingIn: string;
    login: string;
    wrongCredentials: string;
    language: string;
  }
> = {
  ru: {
    title: "Админ-панель",
    subtitle: "Введите логин и пароль",
    username: "Логин",
    password: "Пароль",
    loggingIn: "Вход...",
    login: "Войти",
    wrongCredentials: "Неверный логин или пароль",
    language: "Язык",
  },
  kk: {
    title: "Әкімші панелі",
    subtitle: "Логин мен құпия сөзді енгізіңіз",
    username: "Логин",
    password: "Құпия сөз",
    loggingIn: "Кіру...",
    login: "Кіру",
    wrongCredentials: "Логин немесе құпия сөз қате",
    language: "Тіл",
  },
  en: {
    title: "Admin panel",
    subtitle: "Enter your username and password",
    username: "Username",
    password: "Password",
    loggingIn: "Signing in...",
    login: "Sign in",
    wrongCredentials: "Wrong username or password",
    language: "Language",
  },
  uz: {
    title: "Admin paneli",
    subtitle: "Login va parolni kiriting",
    username: "Login",
    password: "Parol",
    loggingIn: "Kirilmoqda...",
    login: "Kirish",
    wrongCredentials: "Login yoki parol noto‘g‘ri",
    language: "Til",
  },
};

function LoginPage() {
  const router = useRouter();
  const login = useServerFn(adminLogin);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [locale, setLocale] = useState<Locale>("ru");

  useEffect(() => {
    const saved = window.localStorage.getItem("admin-locale");
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved))
      setLocale(saved as Locale);
  }, []);

  function changeLocale(next: Locale) {
    setLocale(next);
    window.localStorage.setItem("admin-locale", next);
    document.documentElement.lang = next;
  }

  const c = copy[locale];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login({ data: { username, password } });
      if (res.ok) {
        await router.navigate({ to: "/admin" });
      } else {
        setError(c.wrongCredentials);
      }
    } catch (e: unknown) {
      // adminLogin бросает настоящую ошибку на блокировку после подбора
      // пароля («слишком много попыток, через N минут») и на сбой окружения
      // — раньше это было не поймать, и после нескольких неверных попыток
      // спиннер просто останавливался без единого слова объяснения.
      setError(errorMessage(e) || c.wrongCredentials);
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
        <div className="flex items-center justify-end">
          <select
            aria-label={c.language}
            value={locale}
            onChange={(e) => changeLocale(e.target.value as Locale)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            {SUPPORTED_LOCALES.map((code) => (
              <option key={code} value={code}>
                {localeNames[code]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">{c.title}</h1>
          <p className="text-sm text-muted-foreground">{c.subtitle}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">{c.username}</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{c.password}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? c.loggingIn : c.login}
        </Button>
      </form>
    </div>
  );
}
