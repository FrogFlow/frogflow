import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import {
  createCategory,
  deleteCategory,
  listCategories,
  setCategoryVisible,
  updateCategory,
} from "@/lib/categories.functions";
import { getSettings, saveSetting } from "@/lib/settings.functions";
import {
  getCategoryPath,
  parseMiniAppCatalogSettings,
  sortCategoriesTree,
  type MiniAppCatalogLayout,
} from "@/lib/category-tree";
import { confirmToast } from "@/lib/confirm-toast";
import { EmojiInsertBar, insertAtCursor } from "@/components-ui/emoji-insert-bar";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { useModules } from "@/lib/modules/use-modules";
import { useVertical } from "@/lib/verticals/use-vertical";

export const Route = createFileRoute("/admin/categories")({
  component: CategoriesPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    hint: string;
    hintPhysical: string;
    miniAppTitle: string;
    miniAppHint: string;
    miniAppLayoutLabel: string;
    miniAppLayoutTree: string;
    miniAppLayoutFlat: string;
    miniAppLayoutCustom: string;
    miniAppOrderHint: string;
    miniAppSave: string;
    miniAppSaved: string;
    miniAppSaveError: (msg: string) => string;
    editingTitle: string;
    newTitle: string;
    name: string;
    namePlaceholder: string;
    namePlaceholderPhysical: string;
    emojiHint: string;
    parentLabel: string;
    rootOption: string;
    hiddenSuffix: string;
    visibleCheckbox: string;
    save: string;
    create: string;
    cancel: string;
    listTitle: string;
    empty: string;
    loading: string;
    loadError: (msg: string) => string;
    hiddenBadge: string;
    show: string;
    hide: string;
    editShort: string;
    deleteShort: string;
    confirmDelete: string;
    confirmDeletePhysical: string;
    saveError: (msg: string) => string;
    deleteError: (msg: string) => string;
    toggleError: (msg: string) => string;
  }
> = {
  ru: {
    title: "Категории",
    hint: "Скрытые категории не показываются в каталоге бота, но товары и файлы сохраняются. Удобно для сезонных папок (1 сентября, День учителя).",
    hintPhysical:
      "Скрытые категории не показываются в каталоге бота, но товары сохраняются. Удобно для сезонных папок (Новый год, 8 марта).",
    miniAppTitle: "Категории в Mini App",
    miniAppHint:
      "В боте покупатель сначала видит корневые папки, затем подкатегории. Здесь можно оставить тот же порядок, показать все папки лентой или собрать свой набор именно для магазинчика.",
    miniAppLayoutLabel: "Как показывать в Mini App",
    miniAppLayoutTree: "Как в боте: сначала основные, внутри — подкатегории",
    miniAppLayoutFlat: "Все категории одной лентой",
    miniAppLayoutCustom: "Свой набор и порядок для Mini App",
    miniAppOrderHint:
      "Отметьте категории, которые будут на первом экране Mini App. Порядок — сверху вниз.",
    miniAppSave: "Сохранить вид Mini App",
    miniAppSaved: "Сохранено",
    miniAppSaveError: (msg) => `Не удалось сохранить вид Mini App: ${msg}`,
    editingTitle: "Редактирование",
    newTitle: "Новая категория",
    name: "Название",
    namePlaceholder: "Например: 📐 Математика",
    namePlaceholderPhysical: "Например: 🎂 Торты",
    emojiHint:
      "Эмодзи в названии отображаются в кнопках каталога бота. На ПК — кликните ниже или Win+. / Ctrl+Cmd+Space.",
    parentLabel: "Родительская категория",
    rootOption: "— Корневая —",
    hiddenSuffix: " (скрыта)",
    visibleCheckbox: "Видна в каталоге бота",
    save: "Сохранить",
    create: "Создать",
    cancel: "Отмена",
    listTitle: "Список (дерево)",
    empty: "Пока пусто.",
    loading: "Загрузка…",
    loadError: (msg) => `Не удалось загрузить категории: ${msg}`,
    hiddenBadge: "скрыта",
    show: "Показать",
    hide: "Скрыть",
    editShort: "Изм.",
    deleteShort: "Удал.",
    confirmDelete:
      "Удалить категорию? Подкатегории тоже удалятся. Товары и файлы останутся; связь с этой папкой снимется.",
    confirmDeletePhysical:
      "Удалить категорию? Подкатегории тоже удалятся. Товары останутся; связь с этой папкой снимется.",
    saveError: (msg) => `Не удалось сохранить категорию: ${msg}`,
    deleteError: (msg) => `Не удалось удалить категорию: ${msg}`,
    toggleError: (msg) => `Не удалось изменить видимость: ${msg}`,
  },
  kk: {
    title: "Санаттар",
    hint: "Жасырын санаттар бот каталогында көрсетілмейді, бірақ тауарлар мен файлдар сақталады. Маусымдық қалталар үшін ыңғайлы.",
    hintPhysical:
      "Жасырын санаттар бот каталогында көрсетілмейді, бірақ тауарлар сақталады. Маусымдық қалталар үшін ыңғайлы.",
    miniAppTitle: "Mini App санаттары",
    miniAppHint:
      "Ботта алдымен түбір қалталар, сосын ішкі санаттар көрінеді. Mini App үшін сол тәртіпті қалдыруға, барлығын лентамен көрсетуге немесе өз жиынтықты жинауға болады.",
    miniAppLayoutLabel: "Mini App-та қалай көрсету",
    miniAppLayoutTree: "Боттағыдай: алдымен негізгі, ішінде — ішкі санаттар",
    miniAppLayoutFlat: "Барлық санаттар бір лентада",
    miniAppLayoutCustom: "Mini App үшін өз жиынтық пен тәртіп",
    miniAppOrderHint:
      "Mini App бірінші экранындағы санаттарды белгілеңіз. Тәртіп — жоғарыдан төмен.",
    miniAppSave: "Mini App түрін сақтау",
    miniAppSaved: "Сақталды",
    miniAppSaveError: (msg) => `Mini App түрін сақтау мүмкін болмады: ${msg}`,
    editingTitle: "Өңдеу",
    newTitle: "Жаңа санат",
    name: "Атауы",
    namePlaceholder: "Мысалы: 📐 Математика",
    namePlaceholderPhysical: "Мысалы: 🎂 Торттар",
    emojiHint:
      "Атаудағы эмодзи бот каталогының түймелерінде көрсетіледі. ПК-де — төменнен басыңыз немесе Win+. / Ctrl+Cmd+Space.",
    parentLabel: "Аталық санат",
    rootOption: "— Түбір —",
    hiddenSuffix: " (жасырын)",
    visibleCheckbox: "Бот каталогында көрінеді",
    save: "Сақтау",
    create: "Құру",
    cancel: "Бас тарту",
    listTitle: "Тізім (ағаш)",
    empty: "Әзірге бос.",
    loading: "Жүктелуде…",
    loadError: (msg) => `Санаттарды жүктеу мүмкін болмады: ${msg}`,
    hiddenBadge: "жасырын",
    show: "Көрсету",
    hide: "Жасыру",
    editShort: "Өзг.",
    deleteShort: "Жою",
    confirmDelete:
      "Санатты жою керек пе? Ішкі санаттар да жойылады. Тауарлар мен файлдар сақталады; бұл қалтамен байланыс алынады.",
    confirmDeletePhysical:
      "Санатты жою керек пе? Ішкі санаттар да жойылады. Тауарлар сақталады; бұл қалтамен байланыс алынады.",
    saveError: (msg) => `Санатты сақтау мүмкін болмады: ${msg}`,
    deleteError: (msg) => `Санатты жою мүмкін болмады: ${msg}`,
    toggleError: (msg) => `Көріну параметрін өзгерту мүмкін болмады: ${msg}`,
  },
  en: {
    title: "Categories",
    hint: "Hidden categories don't show up in the bot's catalog, but their products and files are kept. Handy for seasonal folders (e.g. holiday sales).",
    hintPhysical:
      "Hidden categories don't show up in the bot's catalog, but their products are kept. Handy for seasonal folders (New Year, 8 March).",
    miniAppTitle: "Mini App categories",
    miniAppHint:
      "In the bot, buyers see root folders first, then subcategories. Keep that tree, show every folder in one row, or pick a custom Mini App set.",
    miniAppLayoutLabel: "How to show categories in Mini App",
    miniAppLayoutTree: "Same as the bot: mains first, subcategories inside",
    miniAppLayoutFlat: "All categories in one row",
    miniAppLayoutCustom: "Custom Mini App set and order",
    miniAppOrderHint: "Tick the categories for the Mini App first screen. Order is top to bottom.",
    miniAppSave: "Save Mini App layout",
    miniAppSaved: "Saved",
    miniAppSaveError: (msg) => `Could not save Mini App layout: ${msg}`,
    editingTitle: "Editing",
    newTitle: "New category",
    name: "Name",
    namePlaceholder: "e.g. 📐 Math",
    namePlaceholderPhysical: "e.g. 🎂 Cakes",
    emojiHint:
      "Emoji in the name show up on the bot catalog's buttons. On desktop — click below or Win+. / Ctrl+Cmd+Space.",
    parentLabel: "Parent category",
    rootOption: "— Root —",
    hiddenSuffix: " (hidden)",
    visibleCheckbox: "Visible in the bot catalog",
    save: "Save",
    create: "Create",
    cancel: "Cancel",
    listTitle: "List (tree)",
    empty: "Nothing here yet.",
    loading: "Loading…",
    loadError: (msg) => `Failed to load categories: ${msg}`,
    hiddenBadge: "hidden",
    show: "Show",
    hide: "Hide",
    editShort: "Edit",
    deleteShort: "Delete",
    confirmDelete:
      "Delete this category? Subcategories will be deleted too. Products and files are kept; their link to this folder is removed.",
    confirmDeletePhysical:
      "Delete this category? Subcategories will be deleted too. Products are kept; their link to this folder is removed.",
    saveError: (msg) => `Failed to save the category: ${msg}`,
    deleteError: (msg) => `Failed to delete the category: ${msg}`,
    toggleError: (msg) => `Failed to change visibility: ${msg}`,
  },
  uz: {
    title: "Kategoriyalar",
    hint: "Yashirin kategoriyalar bot katalogida ko‘rsatilmaydi, lekin mahsulot va fayllar saqlanadi. Mavsumiy papkalar uchun qulay.",
    hintPhysical:
      "Yashirin kategoriyalar bot katalogida ko‘rsatilmaydi, lekin mahsulotlar saqlanadi. Mavsumiy papkalar uchun qulay.",
    miniAppTitle: "Mini App kategoriyalari",
    miniAppHint:
      "Botda avval ildiz papkalar, keyin ichki kategoriyalar ko‘rinadi. Mini App uchun shu tartibni qoldirish, hammasini lentada ko‘rsatish yoki o‘z to‘plamingizni yig‘ish mumkin.",
    miniAppLayoutLabel: "Mini App’da qanday ko‘rsatish",
    miniAppLayoutTree: "Botdagidek: avval asosiylar, ichida — ichki kategoriyalar",
    miniAppLayoutFlat: "Barcha kategoriyalar bitta lentada",
    miniAppLayoutCustom: "Mini App uchun o‘z to‘plam va tartib",
    miniAppOrderHint:
      "Mini App birinchi ekrani uchun kategoriyalarni belgilang. Tartib — yuqoridan pastga.",
    miniAppSave: "Mini App ko‘rinishini saqlash",
    miniAppSaved: "Saqlandi",
    miniAppSaveError: (msg) => `Mini App ko‘rinishini saqlab bo‘lmadi: ${msg}`,
    editingTitle: "Tahrirlash",
    newTitle: "Yangi kategoriya",
    name: "Nomi",
    namePlaceholder: "Masalan: 📐 Matematika",
    namePlaceholderPhysical: "Masalan: 🎂 Tortlar",
    emojiHint:
      "Nomdagi emoji bot katalogi tugmalarida ko‘rinadi. Kompyuterda — pastda bosing yoki Win+. / Ctrl+Cmd+Space.",
    parentLabel: "Ota kategoriya",
    rootOption: "— Ildiz —",
    hiddenSuffix: " (yashirin)",
    visibleCheckbox: "Bot katalogida ko‘rinadi",
    save: "Saqlash",
    create: "Yaratish",
    cancel: "Bekor qilish",
    listTitle: "Ro‘yxat (daraxt)",
    empty: "Hozircha bo‘sh.",
    loading: "Yuklanmoqda…",
    loadError: (msg) => `Kategoriyalarni yuklab bo‘lmadi: ${msg}`,
    hiddenBadge: "yashirin",
    show: "Ko‘rsatish",
    hide: "Yashirish",
    editShort: "Tahr.",
    deleteShort: "O‘chir.",
    confirmDelete:
      "Kategoriyani o‘chirasizmi? Quyi kategoriyalar ham o‘chadi. Mahsulot va fayllar saqlanadi; ular bu papka bilan bog‘lanishdan chiqadi.",
    confirmDeletePhysical:
      "Kategoriyani o‘chirasizmi? Quyi kategoriyalar ham o‘chadi. Mahsulotlar saqlanadi; ular bu papka bilan bog‘lanishdan chiqadi.",
    saveError: (msg) => `Kategoriyani saqlab bo‘lmadi: ${msg}`,
    deleteError: (msg) => `Kategoriyani o‘chirib bo‘lmadi: ${msg}`,
    toggleError: (msg) => `Ko‘rinishni o‘zgartirib bo‘lmadi: ${msg}`,
  },
};

type Cat = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  is_visible?: boolean;
};

function CategoriesPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const { isPhysicalShop } = useVertical();
  const qc = useQueryClient();
  const modules = useModules();
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => getSettings() });
  const list = useMemo(() => sortCategoriesTree((cats.data ?? []) as Cat[]), [cats.data]);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [isVisible, setIsVisible] = useState(true);
  const [miniLayout, setMiniLayout] = useState<MiniAppCatalogLayout>("tree");
  const [miniOrder, setMiniOrder] = useState<string[]>([]);
  const [miniSaving, setMiniSaving] = useState(false);
  const [miniSaved, setMiniSaved] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const parsed = parseMiniAppCatalogSettings(settings.data?.mini_app_catalog);
    setMiniLayout(parsed.layout);
    setMiniOrder(parsed.order);
  }, [settings.data?.mini_app_catalog]);
  // Не только сама категория, но и все её потомки — иначе выбор родителя из
  // одной из них создаёт цикл в дереве (Блок 4.6, дублирует серверную
  // проверку в updateCategory ради того, чтобы такой вариант вообще не
  // показывался в списке).
  const editingDescendantIds = useMemo(() => {
    if (!editing) return new Set<string>();
    const ids = new Set<string>([editing.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of list) {
        if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
      }
    }
    return ids;
  }, [editing, list]);

  function insertEmoji(emoji: string) {
    const el = nameInputRef.current;
    const { next, cursor } = insertAtCursor(
      name,
      emoji,
      el?.selectionStart ?? null,
      el?.selectionEnd ?? null,
    );
    setName(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  function reset() {
    setEditing(null);
    setName("");
    setParentId("");
    setIsVisible(true);
  }

  async function onSave() {
    if (!name.trim()) return;
    try {
      if (editing) {
        await updateCategory({
          data: {
            id: editing.id,
            name,
            parent_id: parentId || null,
            is_visible: isVisible,
          },
        });
      } else {
        await createCategory({
          data: { name, parent_id: parentId || null, is_visible: isVisible },
        });
      }
      reset();
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e)));
    }
  }

  async function onDelete(id: string) {
    if (!(await confirmToast(isPhysicalShop ? tr.confirmDeletePhysical : tr.confirmDelete))) return;
    try {
      await deleteCategory({ data: { id } });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: unknown) {
      toast.error(tr.deleteError(errorMessage(e)));
    }
  }

  async function onSaveMiniAppLayout() {
    setMiniSaving(true);
    try {
      await saveSetting({
        data: {
          key: "mini_app_catalog",
          value: JSON.stringify({ layout: miniLayout, order: miniOrder }),
        },
      });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setMiniSaved(true);
      setTimeout(() => setMiniSaved(false), 2000);
    } catch (e: unknown) {
      toast.error(tr.miniAppSaveError(errorMessage(e)));
    } finally {
      setMiniSaving(false);
    }
  }

  function toggleMiniOrder(id: string) {
    setMiniOrder((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function moveMiniOrder(id: string, delta: number) {
    setMiniOrder((prev) => {
      const index = prev.indexOf(id);
      if (index < 0) return prev;
      const next = [...prev];
      const swap = index + delta;
      if (swap < 0 || swap >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(swap, 0, item);
      return next;
    });
  }

  async function onToggleVisible(c: Cat) {
    const next = !(c.is_visible !== false);
    try {
      await setCategoryVisible({ data: { id: c.id, is_visible: next } });
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e: unknown) {
      toast.error(tr.toggleError(errorMessage(e)));
    }
  }

  function depthPrefix(c: Cat): string {
    let d = 0;
    let pid = c.parent_id;
    const byId = new Map(list.map((x) => [x.id, x]));
    while (pid) {
      d++;
      pid = byId.get(pid)?.parent_id ?? null;
      if (d > 20) break;
    }
    return d > 0 ? `${"— ".repeat(d)}` : "";
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{tr.title}</h1>
      <p className="text-sm text-muted-foreground">{isPhysicalShop ? tr.hintPhysical : tr.hint}</p>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h2 className="font-medium">{editing ? tr.editingTitle : tr.newTitle}</h2>
          <div className="space-y-2">
            <Label>{tr.name}</Label>
            <Input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isPhysicalShop ? tr.namePlaceholderPhysical : tr.namePlaceholder}
            />
            <p className="text-xs text-muted-foreground">{tr.emojiHint}</p>
            <EmojiInsertBar onInsert={insertEmoji} />
          </div>
          <div className="space-y-2">
            <Label>{tr.parentLabel}</Label>
            <select
              className="w-full border rounded-md h-9 px-2 bg-background"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">{tr.rootOption}</option>
              {list
                .filter((c) => !editingDescendantIds.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {depthPrefix(c)}
                    {c.name}
                    {c.is_visible === false ? tr.hiddenSuffix : ""}
                  </option>
                ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isVisible}
              onChange={(e) => setIsVisible(e.target.checked)}
            />
            {tr.visibleCheckbox}
          </label>
          <div className="flex gap-2">
            <Button onClick={onSave}>{editing ? tr.save : tr.create}</Button>
            {editing && (
              <Button variant="outline" onClick={reset}>
                {tr.cancel}
              </Button>
            )}
          </div>
        </div>

        <div className="bg-card border rounded-lg p-4">
          <h2 className="font-medium mb-3">{tr.listTitle}</h2>
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {cats.isLoading
                ? tr.loading
                : cats.isError
                  ? tr.loadError(errorMessage(cats.error))
                  : tr.empty}
            </p>
          )}
          <ul className="divide-y">
            {list.map((c) => {
              const hidden = c.is_visible === false;
              return (
                <li key={c.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className={`font-medium ${hidden ? "text-muted-foreground" : ""}`}>
                      {depthPrefix(c)}
                      {c.name}
                      {hidden && (
                        <span className="ml-2 text-xs font-normal text-amber-700">
                          {tr.hiddenBadge}
                        </span>
                      )}
                    </div>
                    {c.parent_id && (
                      <div className="text-xs text-muted-foreground truncate">
                        {getCategoryPath(c.id, list)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => onToggleVisible(c)}>
                      {hidden ? tr.show : tr.hide}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(c);
                        setName(c.name);
                        setParentId(c.parent_id ?? "");
                        setIsVisible(c.is_visible !== false);
                      }}
                    >
                      {tr.editShort}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => onDelete(c.id)}>
                      {tr.deleteShort}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {modules.telegram_mini_app ? (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h2 className="font-medium">{tr.miniAppTitle}</h2>
          <p className="text-sm text-muted-foreground">{tr.miniAppHint}</p>
          <Label>{tr.miniAppLayoutLabel}</Label>
          <div className="space-y-2 text-sm">
            {(
              [
                ["tree", tr.miniAppLayoutTree],
                ["flat", tr.miniAppLayoutFlat],
                ["custom", tr.miniAppLayoutCustom],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mini-app-layout"
                  checked={miniLayout === value}
                  onChange={() => setMiniLayout(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {miniLayout === "custom" ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{tr.miniAppOrderHint}</p>
              <ul className="divide-y border rounded-md">
                {[
                  ...miniOrder
                    .map((id) => list.find((item) => item.id === id))
                    .filter((item): item is Cat => Boolean(item)),
                  ...list.filter((item) => !miniOrder.includes(item.id)),
                ].map((c) => {
                  const selected = miniOrder.includes(c.id);
                  return (
                    <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleMiniOrder(c.id)}
                      />
                      <span className="flex-1 min-w-0 truncate">
                        {depthPrefix(c)}
                        {c.name}
                      </span>
                      {selected ? (
                        <span className="flex gap-1 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => moveMiniOrder(c.id, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => moveMiniOrder(c.id, 1)}
                          >
                            ↓
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Button onClick={onSaveMiniAppLayout} disabled={miniSaving || settings.isLoading}>
              {tr.miniAppSave}
            </Button>
            {miniSaved ? <span className="text-sm text-green-600">{tr.miniAppSaved}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
