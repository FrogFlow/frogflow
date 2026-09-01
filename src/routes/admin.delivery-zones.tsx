import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import {
  countOrdersUsingZone,
  deleteDeliveryZone,
  listDeliveryZones,
  saveDeliveryZone,
} from "@/lib/delivery-zones.functions";
import { listPaymentMethods } from "@/lib/payment-methods.functions";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/delivery-zones")({
  component: DeliveryZonesPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    hint: string;
    addBtn: string;
    name: string;
    namePlaceholder: string;
    price: string;
    sortOrder: string;
    active: string;
    save: string;
    cancel: string;
    empty: string;
    loading: string;
    loadError: (msg: string) => string;
    hidden: string;
    editShort: string;
    deleteShort: string;
    confirmDelete: string;
    /** Блок 9, находка 9.3 — предупреждение о ещё не закрытых заказах на эту зону. */
    confirmDeleteWithOrders: (n: number) => string;
    /** Блок 9, находка 9.4 — цена не заполнена/не число. */
    priceInvalid: string;
    saveError: (msg: string) => string;
    deleteError: (msg: string) => string;
  }
> = {
  ru: {
    title: "Зоны доставки",
    hint:
      "Покупатель выбирает зону при оформлении физического заказа с доставкой — " +
      "её цена добавляется к сумме заказа.",
    addBtn: "+ Добавить",
    name: "Название",
    namePlaceholder: "Центр города",
    price: "Цена доставки",
    sortOrder: "Порядок",
    active: "Активна",
    save: "Сохранить",
    cancel: "Отмена",
    empty: "Нет зон доставки — покупателю будет предложен только свободный адрес.",
    loading: "Загрузка…",
    loadError: (msg) => `Не удалось загрузить зоны доставки: ${msg}`,
    hidden: " · скрыта",
    editShort: "Изм.",
    deleteShort: "Удал.",
    confirmDelete: "Удалить зону доставки?",
    confirmDeleteWithOrders: (n) =>
      `Удалить зону доставки? Она используется в ${n} ещё не закрытых заказах — их история не пострадает (имя и цена зоны уже сохранены в самом заказе), но выбрать эту зону для новых заказов будет нельзя.`,
    priceInvalid: "Укажите цену доставки числом от 0 и больше.",
    saveError: (msg) => `Ошибка при сохранении: ${msg}`,
    deleteError: (msg) => `Не удалось удалить зону: ${msg}`,
  },
  kk: {
    title: "Жеткізу аймақтары",
    hint:
      "Сатып алушы жеткізумен физикалық тапсырысты рәсімдегенде аймақты таңдайды — " +
      "оның бағасы тапсырыс сомасына қосылады.",
    addBtn: "+ Қосу",
    name: "Атауы",
    namePlaceholder: "Қала орталығы",
    price: "Жеткізу бағасы",
    sortOrder: "Реті",
    active: "Белсенді",
    save: "Сақтау",
    cancel: "Бас тарту",
    empty: "Жеткізу аймақтары жоқ — сатып алушыға тек еркін мекенжай ұсынылады.",
    loading: "Жүктелуде…",
    loadError: (msg) => `Жеткізу аймақтарын жүктеу мүмкін болмады: ${msg}`,
    hidden: " · жасырын",
    editShort: "Өзг.",
    deleteShort: "Жою",
    confirmDelete: "Жеткізу аймағын жою керек пе?",
    confirmDeleteWithOrders: (n) =>
      `Жеткізу аймағын жою керек пе? Ол әлі жабылмаған ${n} тапсырыста қолданылады — олардың тарихы зардап шекпейді (аймақтың атауы мен бағасы тапсырыста сақталған), бірақ жаңа тапсырыстарда бұл аймақты таңдау мүмкін болмайды.`,
    priceInvalid: "Жеткізу бағасын 0-ден үлкен немесе тең сан ретінде көрсетіңіз.",
    saveError: (msg) => `Сақтау кезінде қате: ${msg}`,
    deleteError: (msg) => `Аймақты жою мүмкін болмады: ${msg}`,
  },
  en: {
    title: "Delivery zones",
    hint:
      "The buyer picks a zone when placing a physical order with delivery — " +
      "its price is added to the order total.",
    addBtn: "+ Add",
    name: "Name",
    namePlaceholder: "City center",
    price: "Delivery price",
    sortOrder: "Order",
    active: "Active",
    save: "Save",
    cancel: "Cancel",
    empty: "No delivery zones yet — the buyer will only be offered a free-text address.",
    loading: "Loading…",
    loadError: (msg) => `Failed to load delivery zones: ${msg}`,
    hidden: " · hidden",
    editShort: "Edit",
    deleteShort: "Delete",
    confirmDelete: "Delete this delivery zone?",
    confirmDeleteWithOrders: (n) =>
      `Delete this delivery zone? It's used in ${n} still-open orders — their history is unaffected (the zone's name and price are already saved on the order), but new orders won't be able to pick it.`,
    priceInvalid: "Enter a delivery price as a number, 0 or higher.",
    saveError: (msg) => `Failed to save: ${msg}`,
    deleteError: (msg) => `Failed to delete the zone: ${msg}`,
  },
  uz: {
    title: "Yetkazib berish zonalari",
    hint:
      "Xaridor yetkazib berish bilan jismoniy buyurtma berayotganda zonani tanlaydi — " +
      "uning narxi buyurtma summasiga qo‘shiladi.",
    addBtn: "+ Qo‘shish",
    name: "Nomi",
    namePlaceholder: "Shahar markazi",
    price: "Yetkazib berish narxi",
    sortOrder: "Tartib",
    active: "Faol",
    save: "Saqlash",
    cancel: "Bekor qilish",
    empty: "Yetkazib berish zonalari yo‘q — xaridorga faqat erkin manzil taklif qilinadi.",
    loading: "Yuklanmoqda…",
    loadError: (msg) => `Yetkazib berish zonalarini yuklab bo‘lmadi: ${msg}`,
    hidden: " · yashirin",
    editShort: "Tahr.",
    deleteShort: "O‘chir.",
    confirmDelete: "Yetkazib berish zonasini o‘chirasizmi?",
    confirmDeleteWithOrders: (n) =>
      `Yetkazib berish zonasini o‘chirasizmi? U hali yopilmagan ${n} ta buyurtmada ishlatilgan — ularning tarixi zarar ko‘rmaydi (zona nomi va narxi buyurtmada allaqachon saqlangan), lekin yangi buyurtmalarda bu zonani tanlab bo‘lmaydi.`,
    priceInvalid: "Yetkazib berish narxini 0 yoki undan katta son sifatida kiriting.",
    saveError: (msg) => `Saqlashda xato: ${msg}`,
    deleteError: (msg) => `Zonani o‘chirib bo‘lmadi: ${msg}`,
  },
};

type Zone = {
  id?: string;
  name: string;
  price: number;
  sort_order: number;
  is_active: boolean;
};

const empty: Zone = {
  name: "",
  price: 0,
  sort_order: 0,
  is_active: true,
};

function DeliveryZonesPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const zones = useQuery({ queryKey: ["delivery-zones"], queryFn: () => listDeliveryZones() });
  const list = (zones.data ?? []) as Zone[];
  const [editing, setEditing] = useState<Zone | null>(null);

  // Валюта зоны (Блок 9, находка 9.1) — delivery_zones.price по замыслу
  // MIGRATION-52 не конвертируется, значит указана в домашней валюте
  // продавца; тем же приёмом определения "домашней" страны, что
  // pricing.server.ts (loadMethods): первая не-OTHER страна по sort_order.
  const pMethods = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => listPaymentMethods(),
  });
  const homeCurrency =
    (pMethods.data ?? []).find((m) => m.country_code !== "OTHER")?.currency ?? "";

  async function onSave() {
    if (!editing) return;
    // Блок 9, находка 9.4 — раньше пустое поле цены давало NaN, отправленный
    // на сервер, и падало сырым сообщением Zod ("Expected number, received
    // nan"), которое ничего не говорит продавцу.
    if (!Number.isFinite(editing.price) || editing.price < 0) {
      toast.error(tr.priceInvalid);
      return;
    }
    try {
      await saveDeliveryZone({ data: editing });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["delivery-zones"] });
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e)));
    }
  }
  async function onDelete(id: string) {
    // Блок 9, находка 9.3 — считаем открытые заказы на эту зону до
    // подтверждения удаления, чтобы продавец не удалял её вслепую.
    let message = tr.confirmDelete;
    try {
      const { count } = await countOrdersUsingZone({ data: { id } });
      if (count > 0) message = tr.confirmDeleteWithOrders(count);
    } catch (e: unknown) {
      console.error("[admin.delivery-zones] countOrdersUsingZone failed", e);
    }
    if (!(await confirmToast(message))) return;
    try {
      await deleteDeliveryZone({ data: { id } });
      qc.invalidateQueries({ queryKey: ["delivery-zones"] });
    } catch (e: unknown) {
      toast.error(tr.deleteError(errorMessage(e)));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr.title}</h1>
        {!editing && <Button onClick={() => setEditing({ ...empty })}>{tr.addBtn}</Button>}
      </div>
      <p className="text-sm text-muted-foreground">{tr.hint}</p>

      {editing && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-2 md:col-span-2">
              <Label>{tr.name}</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder={tr.namePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {tr.price}
                {homeCurrency ? ` (${homeCurrency})` : ""}
              </Label>
              <Input
                type="number"
                value={editing.price}
                onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{tr.sortOrder}</Label>
              <Input
                type="number"
                value={editing.sort_order}
                onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm pt-7">
              <input
                type="checkbox"
                checked={editing.is_active}
                onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
              />
              {tr.active}
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={onSave}>{tr.save}</Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tr.cancel}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-card border rounded-lg divide-y">
        {list.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            {zones.isLoading
              ? tr.loading
              : zones.isError
                ? tr.loadError(errorMessage(zones.error))
                : tr.empty}
          </div>
        )}
        {list.map((z) => (
          <div key={z.id} className="p-3 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                {z.name}
                {!z.is_active && <span className="text-xs text-muted-foreground">{tr.hidden}</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {z.price}
                {homeCurrency ? ` ${homeCurrency}` : ""}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setEditing(z)}>
                {tr.editShort}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onDelete(z.id!)}>
                {tr.deleteShort}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
