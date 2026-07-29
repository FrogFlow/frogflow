import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/orders.functions";

export const Route = createFileRoute("/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const stats = useQuery({ queryKey: ["dashboard-stats"], queryFn: () => getDashboardStats() });
  const s = stats.data;

  const products = s?.products ?? 0;
  const total = s?.total ?? 0;
  const awaiting = s?.awaiting ?? 0;
  const delivered = s?.delivered ?? 0;
  const delivering = s?.delivering ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Дашборд</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Товары" value={products} />
        <Stat label="Всего заказов" value={total} />
        <Stat label="Ждут подтверждения" value={awaiting} highlight={awaiting > 0} />
        <Stat label="Выдано" value={delivered} />
      </div>
      {delivering > 0 && (
        <p className="text-sm text-blue-700">
          Выдаётся сейчас: <b>{delivering}</b> — порции файлов ещё идут (см. «Заказы» → Продолжить выдачу).
        </p>
      )}
      <div className="bg-card border rounded-lg p-4">
        <h2 className="font-medium mb-2">Как пользоваться</h2>
        <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
          <li>Создайте категории и добавьте товары.</li>
          <li>В разделе «Реквизиты» отредактируйте инструкции по оплате для каждой страны.</li>
          <li>В «Настройках» укажите ваш Telegram ID — туда будут приходить уведомления о заказах.</li>
          <li>
            При выключенной Robokassa: проверьте скриншот и нажмите «Подтвердить». При включённой — для RU/BY/OTHER/KZ
            чек может выдать файлы сразу (уведомление без кнопки); прочие страны — через Robokassa.
          </li>
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 bg-card ${highlight ? "border-primary ring-1 ring-primary/40" : ""}`}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}
