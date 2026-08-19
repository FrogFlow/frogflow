import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components-ui/button";
import { Badge } from "@/components-ui/badge";
import { useModules } from "@/lib/modules/use-modules";
import { MODULE_KEYS, moduleDef, type ModuleKey } from "@/lib/modules/registry";
import {
  getPendingModuleRequests,
  requestModuleConnection,
} from "@/lib/modules/module-requests.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import { t, type Locale } from "@/lib/i18n";
import { errorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/admin/modules")({
  component: ModulesPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    subtitle: string;
    priceOneTime: (n: number) => string;
    requires: (title: string) => string;
  }
> = {
  ru: {
    title: "Модули",
    subtitle:
      "Каталог готовых модулей для вашего магазина — уже подключённые и доступные к заказу.",
    priceOneTime: (n) => `${n.toLocaleString("ru-RU")} ₸ разово`,
    requires: (title) => `Требует: ${title}`,
  },
  kk: {
    title: "Модульдер",
    subtitle:
      "Дүкеніңіз үшін дайын модульдер каталогы — қосылғандары және тапсырысқа қолжетімдісі.",
    priceOneTime: (n) => `${n.toLocaleString("ru-RU")} ₸ бір реттік`,
    requires: (title) => `Талап етеді: ${title}`,
  },
  en: {
    title: "Modules",
    subtitle: "Catalog of ready modules for your shop — what's connected and what you can request.",
    priceOneTime: (n) => `${n.toLocaleString("en-US")} ₸ one-time`,
    requires: (title) => `Requires: ${title}`,
  },
  uz: {
    title: "Modullar",
    subtitle:
      "Do‘koningiz uchun tayyor modullar katalogi — ulanganlari va buyurtma qilish mumkinlari.",
    priceOneTime: (n) => `${n.toLocaleString("ru-RU")} ₸ bir martalik`,
    requires: (title) => `Talab qiladi: ${title}`,
  },
};

function ModulesPage() {
  const { locale } = useAdminLocale();
  const c = copy[locale];
  const owned = useModules();
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["module-requests-pending"],
    queryFn: () => getPendingModuleRequests(),
  });
  const pendingSet = new Set(pending.data ?? []);

  const request = useMutation({
    mutationFn: (moduleKey: ModuleKey) => requestModuleConnection({ data: { moduleKey } }),
    onSuccess: (res) => {
      toast.success(t("requestSent", locale));
      qc.invalidateQueries({ queryKey: ["module-requests-pending"] });
      if (res.telegramUrl) window.open(res.telegramUrl, "_blank", "noopener,noreferrer");
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const available = MODULE_KEYS.filter((k) => moduleDef(k).status === "available");
  const groups = new Map<string, ModuleKey[]>();
  for (const key of available) {
    const g = moduleDef(key).group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(key);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{c.subtitle}</p>
      </div>

      {[...groups.entries()].map(([group, keys]) => (
        <div key={group} className="space-y-3">
          <h2 className="text-sm font-medium uppercase text-muted-foreground">{group}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {keys.map((key) => {
              const def = moduleDef(key);
              const isOwned = owned[key];
              const isPending = pendingSet.has(key);
              const missingRequires = (def.requires ?? []).filter((rk) => !owned[rk as ModuleKey]);

              return (
                <div key={key} className="bg-card border rounded-lg p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium">{def.title}</h3>
                    {isOwned && <Badge>{t("connected", locale)}</Badge>}
                  </div>
                  {def.note && <p className="text-xs text-muted-foreground">{def.note}</p>}
                  <p className="text-sm text-muted-foreground">
                    {def.price == null ? t("includedInPlan", locale) : c.priceOneTime(def.price)}
                  </p>
                  {!isOwned && missingRequires.length > 0 && (
                    <p className="text-xs text-amber-600">
                      {c.requires(
                        missingRequires.map((rk) => moduleDef(rk as ModuleKey).title).join(", "),
                      )}
                    </p>
                  )}
                  {!isOwned && (
                    <Button
                      size="sm"
                      variant={isPending ? "secondary" : "default"}
                      disabled={isPending || request.isPending}
                      onClick={() => request.mutate(key)}
                    >
                      {isPending ? t("alreadyRequested", locale) : t("requestConnection", locale)}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
