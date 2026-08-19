import { createFileRoute, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  blockTelegramUserFn,
  listBlockedUsersFn,
  unblockTelegramUserFn,
} from "@/lib/blocked-users.functions";
import { searchTelegramUsersFn, type TelegramUserHit } from "@/lib/users-search.functions";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/blocked")({
  beforeLoad: ({ context }) => {
    if (!context.modules.blocked) throw redirect({ to: "/admin" });
  },
  component: BlockedUsersPage,
});

const dateLocales: Record<Locale, string> = {
  ru: "ru-RU",
  kk: "kk-KZ",
  en: "en-US",
  uz: "uz-UZ",
};

const copy: Record<
  Locale,
  {
    title: string;
    hint: string;
    findTitle: string;
    searchLabel: string;
    searchPlaceholder: string;
    searchHint: string;
    searching: string;
    idLabel: string;
    idPlaceholder: string;
    selected: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    blockBtn: string;
    blockedTitle: (n: number) => string;
    empty: string;
    reason: string;
    unblock: string;
    unblockConfirm: (id: number) => string;
    blockConfirm: (id: string) => string;
    provideId: string;
    unknown: string;
  }
> = {
  ru: {
    title: "Чёрный список",
    hint: "Заблокированные пользователи не могут пользоваться магазином и VIP-ботом. Доступ к группе закрывается автоматически.",
    findTitle: "Найти и заблокировать",
    searchLabel: "Поиск по базе (ID, @username, имя)",
    searchPlaceholder: "Например: Иван или 1580128256",
    searchHint: "Ищет среди пользователей магазина и VIP-подписчиков.",
    searching: " Поиск…",
    idLabel: "Telegram ID",
    idPlaceholder: "1580128256",
    selected: "Выбран:",
    reasonLabel: "Причина (необязательно)",
    reasonPlaceholder: "Перепродажа материалов, пиратство…",
    blockBtn: "Заблокировать",
    blockedTitle: (n) => `Заблокированные (${n})`,
    empty: "Список пуст.",
    reason: "Причина:",
    unblock: "Разблокировать",
    unblockConfirm: (id) => `Разблокировать пользователя ${id}?`,
    blockConfirm: (id) =>
      `Заблокировать пользователя ${id}?\n\nБот перестанет отвечать, доступ к VIP-группе будет закрыт, активные подписки и незавершённые заказы отменятся.`,
    provideId: "Укажите Telegram ID или найдите пользователя",
    unknown: "—",
  },
  kk: {
    title: "Қара тізім",
    hint: "Бұғатталған пайдаланушылар дүкен мен VIP-ботты пайдалана алмайды. Топқа қолжетімділік автоматты түрде жабылады.",
    findTitle: "Табу және бұғаттау",
    searchLabel: "Базадан іздеу (ID, @username, аты)",
    searchPlaceholder: "Мысалы: Иван немесе 1580128256",
    searchHint: "Дүкен пайдаланушылары мен VIP жазылушылар арасынан іздейді.",
    searching: " Ізделуде…",
    idLabel: "Telegram ID",
    idPlaceholder: "1580128256",
    selected: "Таңдалды:",
    reasonLabel: "Себеп (міндетті емес)",
    reasonPlaceholder: "Материалдарды қайта сату, пиратство…",
    blockBtn: "Бұғаттау",
    blockedTitle: (n) => `Бұғатталғандар (${n})`,
    empty: "Тізім бос.",
    reason: "Себеп:",
    unblock: "Бұғаттан шығару",
    unblockConfirm: (id) => `${id} пайдаланушысын бұғаттан шығару керек пе?`,
    blockConfirm: (id) =>
      `${id} пайдаланушысын бұғаттау керек пе?\n\nБот жауап беруді тоқтатады, VIP-топқа қолжетімділік жабылады, белсенді жазылымдар мен аяқталмаған тапсырыстар бас тартылады.`,
    provideId: "Telegram ID көрсетіңіз немесе пайдаланушыны табыңыз",
    unknown: "—",
  },
  en: {
    title: "Blocklist",
    hint: "Blocked users can't use the shop or the VIP bot. Access to the group is revoked automatically.",
    findTitle: "Find and block",
    searchLabel: "Search the database (ID, @username, name)",
    searchPlaceholder: "e.g. John or 1580128256",
    searchHint: "Searches among shop users and VIP subscribers.",
    searching: " Searching…",
    idLabel: "Telegram ID",
    idPlaceholder: "1580128256",
    selected: "Selected:",
    reasonLabel: "Reason (optional)",
    reasonPlaceholder: "Reselling materials, piracy…",
    blockBtn: "Block",
    blockedTitle: (n) => `Blocked (${n})`,
    empty: "The list is empty.",
    reason: "Reason:",
    unblock: "Unblock",
    unblockConfirm: (id) => `Unblock user ${id}?`,
    blockConfirm: (id) =>
      `Block user ${id}?\n\nThe bot will stop responding, VIP group access will be revoked, and any active subscriptions and unfinished orders will be cancelled.`,
    provideId: "Enter a Telegram ID or find a user",
    unknown: "—",
  },
  uz: {
    title: "Qora ro‘yxat",
    hint: "Bloklangan foydalanuvchilar do‘kon va VIP-botdan foydalana olmaydi. Guruhga kirish avtomatik yopiladi.",
    findTitle: "Topish va bloklash",
    searchLabel: "Bazadan qidirish (ID, @username, ism)",
    searchPlaceholder: "Masalan: Ivan yoki 1580128256",
    searchHint: "Do‘kon foydalanuvchilari va VIP obunachilar orasidan qidiradi.",
    searching: " Qidirilmoqda…",
    idLabel: "Telegram ID",
    idPlaceholder: "1580128256",
    selected: "Tanlandi:",
    reasonLabel: "Sabab (ixtiyoriy)",
    reasonPlaceholder: "Materiallarni qayta sotish, piratlik…",
    blockBtn: "Bloklash",
    blockedTitle: (n) => `Bloklanganlar (${n})`,
    empty: "Ro‘yxat bo‘sh.",
    reason: "Sabab:",
    unblock: "Blokdan chiqarish",
    unblockConfirm: (id) => `${id} foydalanuvchisini blokdan chiqarasizmi?`,
    blockConfirm: (id) =>
      `${id} foydalanuvchisini bloklaysizmi?\n\nBot javob berishni to‘xtatadi, VIP-guruhga kirish yopiladi, faol obunalar va tugallanmagan buyurtmalar bekor qilinadi.`,
    provideId: "Telegram ID ko‘rsating yoki foydalanuvchini toping",
    unknown: "—",
  },
};

function BlockedUsersPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const blocked = useQuery({ queryKey: ["blocked_users"], queryFn: () => listBlockedUsersFn() });
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<TelegramUserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [telegramId, setTelegramId] = useState("");
  const [selectedUser, setSelectedUser] = useState<TelegramUserHit | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchTelegramUsersFn({ data: { query: q } });
        if (!cancelled) setHits(res as TelegramUserHit[]);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  function pickUser(u: TelegramUserHit) {
    setSelectedUser(u);
    setTelegramId(String(u.telegram_id));
    setSearch("");
    setHits([]);
  }

  async function onBlock() {
    const id = telegramId.trim();
    if (!id) return toast.warning(tr.provideId);
    if (!confirm(tr.blockConfirm(id))) return;
    setBusy(true);
    try {
      await blockTelegramUserFn({
        data: {
          telegram_id: id,
          reason: reason.trim() || undefined,
          username: selectedUser?.username ?? undefined,
          first_name: selectedUser?.first_name ?? undefined,
        },
      });
      setTelegramId("");
      setSelectedUser(null);
      setReason("");
      setSearch("");
      await qc.invalidateQueries({ queryKey: ["blocked_users"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onUnblock(id: number) {
    if (!confirm(tr.unblockConfirm(id))) return;
    setBusy(true);
    try {
      await unblockTelegramUserFn({ data: { telegram_id: id } });
      await qc.invalidateQueries({ queryKey: ["blocked_users"] });
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const list = blocked.data ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">{tr.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{tr.hint}</p>
      </div>

      <div className="bg-card border rounded-lg p-4 space-y-4">
        <h2 className="font-medium">{tr.findTitle}</h2>
        <div className="space-y-2">
          <Label>{tr.searchLabel}</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr.searchPlaceholder}
          />
          <p className="text-xs text-muted-foreground">
            {tr.searchHint}
            {searching ? tr.searching : ""}
          </p>
          {hits.length > 0 && (
            <ul className="border rounded-md divide-y max-h-48 overflow-y-auto">
              {hits.map((u) => (
                <li key={u.telegram_id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                    onClick={() => pickUser(u)}
                  >
                    <span className="font-medium">
                      {[u.first_name, u.last_name].filter(Boolean).join(" ") || tr.unknown}
                    </span>
                    {u.username ? ` @${u.username}` : ""}
                    <span className="text-muted-foreground"> · ID {u.telegram_id}</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      ({u.sources.join(", ")})
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <Label>{tr.idLabel}</Label>
          <Input
            value={telegramId}
            onChange={(e) => {
              setTelegramId(e.target.value);
              setSelectedUser(null);
            }}
            placeholder={tr.idPlaceholder}
          />
          {selectedUser && (
            <p className="text-xs text-muted-foreground">
              {tr.selected}{" "}
              {[selectedUser.first_name, selectedUser.last_name].filter(Boolean).join(" ") ||
                tr.unknown}
              {selectedUser.username ? ` @${selectedUser.username}` : ""}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label>{tr.reasonLabel}</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={tr.reasonPlaceholder}
          />
        </div>
        <Button onClick={onBlock} disabled={busy}>
          {tr.blockBtn}
        </Button>
      </div>

      <div className="space-y-3">
        <h2 className="font-medium">{tr.blockedTitle(list.length)}</h2>
        {list.length === 0 && <p className="text-sm text-muted-foreground">{tr.empty}</p>}
        {list.map((u) => (
          <div
            key={u.telegram_id}
            className="bg-card border rounded-lg p-3 text-sm flex flex-wrap items-start justify-between gap-3"
          >
            <div>
              <div className="font-medium">
                {u.first_name || tr.unknown}{" "}
                {u.username ? `@${u.username}` : `ID: ${u.telegram_id}`}
              </div>
              <div className="text-muted-foreground">ID: {u.telegram_id}</div>
              {u.reason && (
                <div className="mt-1">
                  {tr.reason} {u.reason}
                </div>
              )}
              <div className="text-xs text-muted-foreground mt-1">
                {new Date(u.blocked_at).toLocaleString(dateLocales[locale])}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onUnblock(u.telegram_id)}
            >
              {tr.unblock}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
