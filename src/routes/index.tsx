import { createFileRoute, Link, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // Панель оператора — не магазин: у неё нет арендатора, и эта страница
  // работала бы под service_role. См. lib/control-plane.server.ts. Раньше
  // здесь был notFound() — открыв корень деплоя панели, оператор упирался
  // в голый 404 и должен был вручную дописывать /operator в адресную
  // строку. Редирект прямо на вход в панель убирает этот лишний шаг.
  beforeLoad: ({ context }) => {
    if (context.isPanel) throw redirect({ to: "/operator" });
  },
  head: () => ({
    meta: [
      { title: "Магазин — админ-панель" },
      { name: "description", content: "Telegram-каталог учебных материалов" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-3xl font-semibold">📚 Telegram-каталог</h1>
        <p className="text-muted-foreground">
          Админ-панель для управления товарами, заказами и реквизитами оплаты.
        </p>
        <Link
          to="/admin"
          className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Открыть админ-панель
        </Link>
      </div>
    </div>
  );
}
