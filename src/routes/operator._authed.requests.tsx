import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listBotsFn, setModuleFn } from "@/lib/operator/bots.functions";
import {
  listPendingModuleRequestsFn,
  resolveModuleRequestFn,
} from "@/lib/operator/module-requests.functions";
import { moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { Button } from "@/components-ui/button";

export const Route = createFileRoute("/operator/_authed/requests")({
  head: () => ({ meta: [{ title: "Заявки на модули — панель оператора" }] }),
  component: OperatorRequestsPage,
});

/**
 * Единая очередь заявок «Заказать подключение» со всех клиентов сразу.
 *
 * Раньше заявка была видна только в двух местах: строкой в баннере «Требует
 * внимания» на главной (без деталей — только имя клиента) или на карточке
 * самого клиента, если знать, к кому именно заходить. Живая заявка — это
 * потенциальные деньги, и пропустить её было легко: ничего не выделяло
 * страницу клиента среди остальных шести. Здесь — все заявки от всех
 * клиентов одной лентой, самая старая внизу, с кнопкой включить модуль сразу
 * на месте, не переходя на карточку.
 */
function OperatorRequestsPage() {
  const qc = useQueryClient();
  // Тот же ключ запроса, что и на главной и на карточке клиента — три места
  // читают одни и те же данные и держат один и тот же кеш.
  const requests = useQuery({
    queryKey: ["operator_module_requests"],
    queryFn: () => listPendingModuleRequestsFn(),
    refetchInterval: 15_000,
  });
  const bots = useQuery({
    queryKey: ["operator_bots"],
    queryFn: () => listBotsFn(),
    refetchInterval: 15_000,
  });
  const names = new Map((bots.data ?? []).map((b) => [b.id, b.bot_name]));

  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function onResolve(botId: string, moduleKey: ModuleKey) {
    setBusyKey(`${botId}:${moduleKey}`);
    try {
      await resolveModuleRequestFn({ data: { botId, moduleKey } });
      await qc.invalidateQueries({ queryKey: ["operator_module_requests"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function onEnable(botId: string, moduleKey: ModuleKey) {
    setBusyKey(`${botId}:${moduleKey}`);
    try {
      await setModuleFn({ data: { botId, key: moduleKey, enabled: true } });
      // Включение модуля само по себе не закрывает заявку — оператор мог
      // включить его по другой причине. Закрываем явно тем же действием, раз
      // уж модуль реально включён прямо сейчас.
      await resolveModuleRequestFn({ data: { botId, moduleKey } });
      await qc.invalidateQueries({ queryKey: ["operator_module_requests"] });
      await qc.invalidateQueries({ queryKey: ["operator_bots"] });
      await qc.invalidateQueries({ queryKey: ["operator_bot", botId] });
      toast.success(`${moduleDef(moduleKey).title} включён`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusyKey(null);
    }
  }

  const list = requests.data ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Заявки на модули</h1>
        <p className="text-sm text-muted-foreground mt-1">
          «Заказать подключение» из витрины клиентов — все заявки со всех ботов одной лентой.
        </p>
      </div>

      {requests.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {requests.isError && (
        <p className="text-sm text-destructive">
          {errorMessage(requests.error) || "Не удалось загрузить заявки"}
        </p>
      )}
      {!requests.isLoading && list.length === 0 && (
        <p className="text-sm text-muted-foreground">Необработанных заявок нет.</p>
      )}

      {list.length > 0 && (
        <div className="bg-card border rounded-lg divide-y">
          {list.map((r) => {
            const key = `${r.bot_id}:${r.module_key}`;
            const price = moduleDef(r.module_key)?.price;
            return (
              <div
                key={key}
                className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <div>
                  <Link
                    to="/operator/$botId"
                    params={{ botId: r.bot_id }}
                    className="font-medium hover:underline"
                  >
                    {names.get(r.bot_id) ?? r.bot_id}
                  </Link>
                  <p className="text-muted-foreground">
                    {r.module_title}
                    {price != null && ` · ${price.toLocaleString("ru-RU")} ₸`} ·{" "}
                    {new Date(r.requested_at).toLocaleString("ru-RU")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => onEnable(r.bot_id, r.module_key)}
                    disabled={busyKey === key}
                  >
                    Включить модуль
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onResolve(r.bot_id, r.module_key)}
                    disabled={busyKey === key}
                  >
                    Обработано
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
