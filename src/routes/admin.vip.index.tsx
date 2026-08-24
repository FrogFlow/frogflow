import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getVipSubscriptions } from "@/lib/vip-subscriptions.functions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components-ui/card";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

const copy: Record<
  Locale,
  {
    title: string;
    loadError: (msg: string) => string;
    unknownError: string;
    active: string;
    pending: string;
    expired: string;
  }
> = {
  ru: {
    title: "Дашборд VIP-группы",
    loadError: (msg) => `Не удалось загрузить подписки: ${msg}`,
    unknownError: "неизвестная ошибка",
    active: "Активных подписок",
    pending: "Ожидают оплаты/подтверждения",
    expired: "Истёкших подписок",
  },
  kk: {
    title: "VIP-топ тақтасы",
    loadError: (msg) => `Жазылымдарды жүктеу мүмкін болмады: ${msg}`,
    unknownError: "белгісіз қате",
    active: "Белсенді жазылымдар",
    pending: "Төлем/растауды күтуде",
    expired: "Мерзімі өткен жазылымдар",
  },
  en: {
    title: "VIP group dashboard",
    loadError: (msg) => `Failed to load subscriptions: ${msg}`,
    unknownError: "unknown error",
    active: "Active subscriptions",
    pending: "Awaiting payment/confirmation",
    expired: "Expired subscriptions",
  },
  uz: {
    title: "VIP-guruh boshqaruv paneli",
    loadError: (msg) => `Obunalarni yuklab bo‘lmadi: ${msg}`,
    unknownError: "noma’lum xato",
    active: "Faol obunalar",
    pending: "To‘lov/tasdiqni kutmoqda",
    expired: "Muddati o‘tgan obunalar",
  },
};

export const Route = createFileRoute("/admin/vip/")({
  component: AdminVipDashboard,
});

function AdminVipDashboard() {
  const { locale } = useAdminLocale();
  const c = copy[locale];
  const subs = useQuery({
    queryKey: ["vip_subs", "all"],
    queryFn: () => getVipSubscriptions({ data: { status: "all" } }),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const allSubs = subs.data ?? [];
  const activeSubs = allSubs.filter((s) => s.status === "active");
  const pendingSubs = allSubs.filter((s) => s.status === "pending_payment");
  const expiredSubs = allSubs.filter((s) => s.status === "expired");

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{c.title}</h1>
      </div>

      {subs.isError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 text-sm text-red-700">
            {c.loadError((subs.error as Error)?.message || c.unknownError)}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.active}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{activeSubs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.pending}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">{pendingSubs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.expired}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-muted-foreground">{expiredSubs.length}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
