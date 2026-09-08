import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { getBotReceiptAuditInventoryFn, scanBotReceiptFn } from "@/lib/operator/bots.functions";
import {
  ACTUAL_HANDLING_LABEL,
  OCR_REASON_LABEL,
  OCR_WOULD_LABEL,
  summarizeAuditRows,
  type OcrFailReason,
  type ReceiptAuditRow,
  type SeenReceiptHash,
} from "@/lib/receipt-audit";
import { formatUsd } from "@/lib/smart-search-cost";
import { Button } from "@/components-ui/button";
import { Badge } from "@/components-ui/badge";

type FilterKey = "all" | "mismatch" | "danger";

function severityBadge(severity: ReceiptAuditRow["comparison"]["severity"]) {
  if (severity === "danger") return { text: "выдали, OCR нет", variant: "destructive" as const };
  if (severity === "warn")
    return { text: "выдали, OCR не уверен", variant: "destructive" as const };
  if (severity === "info") return { text: "если бы OCR был", variant: "secondary" as const };
  if (severity === "skip") return { text: "нет файла", variant: "outline" as const };
  return { text: "сошлось", variant: "default" as const };
}

function reasonLabel(reason: string): string {
  if (reason === "ok") return OCR_REASON_LABEL.ok;
  if (reason in OCR_REASON_LABEL) return OCR_REASON_LABEL[reason as OcrFailReason];
  return reason;
}

function toCsv(rows: ReceiptAuditRow[]): string {
  const header = [
    "order_id",
    "display_no",
    "status",
    "actual",
    "ocr_would",
    "severity",
    "title",
    "detail",
    "ocr_reason",
    "expected",
    "matched",
    "currency",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    const cells = [
      row.orderId,
      row.displayNo,
      row.status,
      row.comparison.actual,
      row.comparison.ocrWould,
      row.comparison.severity,
      row.comparison.title,
      row.comparison.detail,
      row.ocrReason,
      row.expectedAmount,
      row.matchedAmount ?? "",
      row.currency ?? "",
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

export function ReceiptAuditSection({ botId, hasDeploy }: { botId: string; hasDeploy: boolean }) {
  const [rows, setRows] = useState<ReceiptAuditRow[]>([]);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const stopRef = useRef(false);
  const seenRef = useRef<SeenReceiptHash[]>([]);

  const inventoryQuery = useQuery({
    queryKey: ["operator_receipt_audit", botId],
    queryFn: () => getBotReceiptAuditInventoryFn({ data: { botId } }),
    enabled: hasDeploy,
  });

  const inventory = inventoryQuery.data?.ok ? inventoryQuery.data.inventory : null;
  const summary = summarizeAuditRows(rows);
  const visible = rows.filter((row) => {
    if (filter === "danger") return row.comparison.severity === "danger";
    if (filter === "mismatch") return !row.comparison.agree && row.comparison.severity !== "skip";
    return true;
  });

  async function runScan() {
    if (!inventory) return;
    const ok = await confirmToast(
      inventory.withFile === 0
        ? "Чеков с файлом нет — запускать нечего."
        : `Прогнать OCR по ${inventory.withFile} чекам (~${formatUsd(inventory.estimatedUsd)})? Заказы не меняются. Каждый файл пойдёт в расход автопроверки клиента.`,
    );
    if (!ok || inventory.withFile === 0) return;
    stopRef.current = false;
    seenRef.current = [];
    setRows([]);
    setRunning(true);
    let afterId = 0;
    try {
      for (;;) {
        if (stopRef.current) break;
        const res = await scanBotReceiptFn({
          data: { botId, afterId, seenHashes: seenRef.current },
        });
        if (!res.ok) {
          toast.error(res.error);
          break;
        }
        const batch =
          res.scan.rows?.length > 0 ? res.scan.rows : res.scan.row ? [res.scan.row] : [];
        if (batch.length === 0) break;
        setRows((prev) => [...prev, ...batch]);
        for (const row of batch) {
          if (row.proofHash) {
            seenRef.current = [
              ...seenRef.current,
              { hash: row.proofHash, orderId: row.orderId, displayNo: row.displayNo },
            ];
          }
        }
        afterId = res.scan.afterId;
        if (res.scan.done) break;
      }
      if (stopRef.current) toast.message("Прогон остановлен");
      else toast.success("Прогон чеков закончен");
    } catch (e: unknown) {
      toast.error(errorMessage(e) || "Не удалось проверить чеки");
    } finally {
      setRunning(false);
    }
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(visible.length === rows.length ? rows : visible)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-audit-${botId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="bg-card border rounded-lg p-4 space-y-4">
      <div>
        <h2 className="font-medium">Проверка чеков</h2>
        <p className="text-sm text-muted-foreground mt-1">
          OCR смотрит сохранённые файлы и говорит, принял бы он чек или нет и почему. Сверяем с тем,
          что уже стоит в заказе — как если бы автопроверку включили раньше. Статусы и выдачу не
          трогаем.
        </p>
      </div>
      {!hasDeploy ? (
        <p className="text-sm text-muted-foreground">
          Нужны адрес деплоя и internal_secret — без них панели некуда спросить чеки.
        </p>
      ) : inventoryQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Считаю чеки в базе…</p>
      ) : inventoryQuery.data && !inventoryQuery.data.ok ? (
        <p className="text-sm text-destructive">{inventoryQuery.data.error}</p>
      ) : inventory ? (
        <div className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <p>
              Чеков с файлом: <span className="font-medium">{inventory.withFile}</span>
            </p>
            <p>
              Оценка Vision:{" "}
              <span className="font-medium">{formatUsd(inventory.estimatedUsd)}</span>
              <span className="text-muted-foreground"> · $2 / 1000</span>
            </p>
            <p>
              Ключ Vision:{" "}
              {inventory.visionConfigured ? (
                <span>есть</span>
              ) : (
                <span className="text-destructive">нет — прогон вернёт «нет ключа»</span>
              )}
            </p>
            <p>
              Модуль / автопроверка: {inventory.moduleEnabled ? "куплен" : "не куплен"}
              {inventory.moduleEnabled
                ? inventory.autoEnabled
                  ? ", тумблер вкл."
                  : ", тумблер выкл."
                : ""}
            </p>
          </div>
          <p className="text-muted-foreground">
            Даже если модуль выключен, OCR ответит «как если бы был включён» — для сверки с ручной
            выдачей. Прогон идёт с новых заказов: у части старых в базе путь есть, а файла в storage
            уже нет — это не сбой OCR, такие просто помечаем.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={runScan} disabled={running || inventory.withFile === 0}>
              {running
                ? `Проверяю… ${rows.length} из ${inventory.withFile}`
                : rows.length
                  ? "Прогнать заново"
                  : "Прогнать OCR"}
            </Button>
            {running ? (
              <Button size="sm" variant="outline" onClick={() => (stopRef.current = true)}>
                Остановить
              </Button>
            ) : null}
            {rows.length > 0 ? (
              <Button size="sm" variant="outline" onClick={downloadCsv} disabled={running}>
                Скачать CSV
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <span>Проверено {summary.total}</span>
            <span>сошлось {summary.ok}</span>
            <span>если бы OCR {summary.info}</span>
            <span>не уверен {summary.warn}</span>
            <span className={summary.danger ? "text-destructive font-medium" : ""}>
              выдали, OCR отклонил бы {summary.danger}
            </span>
            {summary.skip ? <span>нет файла {summary.skip}</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "Все"],
                ["mismatch", "Расхождения"],
                ["danger", "Выдали, OCR нет"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? "default" : "outline"}
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <ul className="divide-y border rounded-md">
            {visible.map((row) => {
              const badge = severityBadge(row.comparison.severity);
              const open = openId === row.orderId;
              return (
                <li key={row.orderId} className="p-3 space-y-1">
                  <button
                    type="button"
                    className="w-full text-left space-y-1"
                    onClick={() => setOpenId(open ? null : row.orderId)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">№{row.displayNo}</span>
                      <Badge variant={badge.variant}>{badge.text}</Badge>
                      <span className="text-xs text-muted-foreground">{row.status}</span>
                    </div>
                    <p className="text-sm">{row.comparison.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.comparison.severity === "skip"
                        ? row.comparison.detail
                        : `В базе: ${ACTUAL_HANDLING_LABEL[row.comparison.actual]} · OCR: ${OCR_WOULD_LABEL[row.comparison.ocrWould]} · ${reasonLabel(row.ocrReason)}`}
                    </p>
                  </button>
                  {open ? (
                    <div className="text-sm space-y-2 pt-2">
                      <p>{row.comparison.detail}</p>
                      <p className="text-muted-foreground">
                        Сумма заказа {row.expectedAmount}
                        {row.currency ? ` ${row.currency}` : ""}
                        {row.matchedAmount != null ? ` · в чеке ${row.matchedAmount}` : ""}
                      </p>
                      {row.extractedPreview ? (
                        <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs max-h-40 overflow-auto">
                          {row.extractedPreview}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">В этом фильтре пусто.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
