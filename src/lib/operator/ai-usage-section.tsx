import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { getBotAiUsageFn, resetBotAiUsageFn } from "@/lib/operator/bots.functions";
import { formatUsd } from "@/lib/smart-search-cost";
import { Button } from "@/components-ui/button";

export function AiUsageSection({
  botId,
  hasSmartSearch,
  hasReceiptOcr,
  hasDeploy,
}: {
  botId: string;
  hasSmartSearch: boolean;
  hasReceiptOcr: boolean;
  hasDeploy: boolean;
}) {
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const usageQuery = useQuery({
    queryKey: ["operator_ai_usage", botId],
    queryFn: () => getBotAiUsageFn({ data: { botId } }),
    enabled: hasDeploy,
  });

  async function onReset() {
    const ok = await confirmToast(
      "Обнулить накопленный расход умного поиска и автопроверки чеков у этого клиента? Обычно так делают после оплаты.",
    );
    if (!ok) return;
    setResetting(true);
    try {
      const res = await resetBotAiUsageFn({ data: { botId } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["operator_ai_usage", botId] });
      toast.success("Расход сброшен в 0");
    } catch (e: unknown) {
      toast.error(errorMessage(e) || "Не удалось сбросить");
    } finally {
      setResetting(false);
    }
  }

  const usage = usageQuery.data?.ok ? usageQuery.data.usage : null;
  const smartUsd = formatUsd(usage?.smartSearch.usd ?? 0);
  const ocrUsd = formatUsd(usage?.receiptOcr.usd ?? 0);
  const totalUsd = formatUsd((usage?.smartSearch.usd ?? 0) + (usage?.receiptOcr.usd ?? 0));

  return (
    <section className="bg-card border rounded-lg p-4 space-y-4">
      <div>
        <h2 className="font-medium">Расход ИИ-сервисов</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Накоплено с последнего сброса, не за день. Клиент оплатил — обнулите счётчик.
        </p>
      </div>
      {!hasDeploy ? (
        <p className="text-sm text-muted-foreground">
          Нужны адрес деплоя и internal_secret — без них панели некуда спросить расход.
        </p>
      ) : usageQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : usageQuery.data && !usageQuery.data.ok ? (
        <p className="text-sm text-destructive">{usageQuery.data.error}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2 border-b pb-2">
            <span className="text-muted-foreground">Умный поиск</span>
            <span>
              {usage?.smartSearch.count ?? 0} запр. · {smartUsd}
              {!hasSmartSearch ? (
                <span className="text-muted-foreground"> · модуль выкл.</span>
              ) : null}
            </span>
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-b pb-2">
            <span className="text-muted-foreground">Автопроверка чеков ($2 / 1000)</span>
            <span>
              {usage?.receiptOcr.count ?? 0} чеков · {ocrUsd}
              {!hasReceiptOcr ? (
                <span className="text-muted-foreground"> · модуль выкл.</span>
              ) : null}
            </span>
          </div>
          <div className="flex flex-wrap justify-between gap-2 font-medium">
            <span>Итого к оплате</span>
            <span>{totalUsd}</span>
          </div>
        </div>
      )}
      <Button variant="outline" size="sm" onClick={onReset} disabled={resetting || !hasDeploy}>
        {resetting ? "Сбрасываю…" : "Сбросить расход в 0"}
      </Button>
    </section>
  );
}
