import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
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
import { getCategoryPath, sortCategoriesTree } from "@/lib/category-tree";
import { confirmToast } from "@/lib/confirm-toast";
import { EmojiInsertBar, insertAtCursor } from "@/components-ui/emoji-insert-bar";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/categories")({
  component: CategoriesPage,
});

const copy: Record<
  Locale,
  {
    title: string;
    hint: string;
    editingTitle: string;
    newTitle: string;
    name: string;
    namePlaceholder: string;
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
    hiddenBadge: string;
    show: string;
    hide: string;
    editShort: string;
    deleteShort: string;
    confirmDelete: string;
  }
> = {
  ru: {
    title: "Категории",
    hint: "Скрытые категории не показываются в каталоге бота, но товары и файлы сохраняются. Удобно для сезонных папок (1 сентября, День учителя).",
    editingTitle: "Редактирование",
    newTitle: "Новая категория",
    name: "Название",
    namePlaceholder: "Например: 📐 Математика",
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
    hiddenBadge: "скрыта",
    show: "Показать",
    hide: "Скрыть",
    editShort: "Изм.",
    deleteShort: "Удал.",
    confirmDelete:
      "Удалить категорию? Подкатегории тоже удалятся. Товары и файлы останутся; связь с этой папкой снимется.",
  },
  kk: {
    title: "Санаттар",
    hint: "Жасырын санаттар бот каталогында көрсетілмейді, бірақ тауарлар мен файлдар сақталады. Маусымдық қалталар үшін ыңғайлы.",
    editingTitle: "Өңдеу",
    newTitle: "Жаңа санат",
    name: "Атауы",
    namePlaceholder: "Мысалы: 📐 Математика",
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
    hiddenBadge: "жасырын",
    show: "Көрсету",
    hide: "Жасыру",
    editShort: "Өзг.",
    deleteShort: "Жою",
    confirmDelete:
      "Санатты жою керек пе? Ішкі санаттар да жойылады. Тауарлар мен файлдар сақталады; бұл қалтамен байланыс алынады.",
  },
  en: {
    title: "Categories",
    hint: "Hidden categories don't show up in the bot's catalog, but their products and files are kept. Handy for seasonal folders (e.g. holiday sales).",
    editingTitle: "Editing",
    newTitle: "New category",
    name: "Name",
    namePlaceholder: "e.g. 📐 Math",
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
    hiddenBadge: "hidden",
    show: "Show",
    hide: "Hide",
    editShort: "Edit",
    deleteShort: "Delete",
    confirmDelete:
      "Delete this category? Subcategories will be deleted too. Products and files are kept; their link to this folder is removed.",
  },
  uz: {
    title: "Kategoriyalar",
    hint: "Yashirin kategoriyalar bot katalogida ko‘rsatilmaydi, lekin mahsulot va fayllar saqlanadi. Mavsumiy papkalar uchun qulay.",
    editingTitle: "Tahrirlash",
    newTitle: "Yangi kategoriya",
    name: "Nomi",
    namePlaceholder: "Masalan: 📐 Matematika",
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
    hiddenBadge: "yashirin",
    show: "Ko‘rsatish",
    hide: "Yashirish",
    editShort: "Tahr.",
    deleteShort: "O‘chir.",
    confirmDelete:
      "Kategoriyani o‘chirasizmi? Quyi kategoriyalar ham o‘chadi. Mahsulot va fayllar saqlanadi; ular bu papka bilan bog‘lanishdan chiqadi.",
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
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const list = useMemo(() => sortCategoriesTree((cats.data ?? []) as Cat[]), [cats.data]);
  const [editing, setEditing] = useState<Cat | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [isVisible, setIsVisible] = useState(true);
  const nameInputRef = useRef<HTMLInputElement>(null);

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
  }

  async function onDelete(id: string) {
    if (!(await confirmToast(tr.confirmDelete))) return;
    await deleteCategory({ data: { id } });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  async function onToggleVisible(c: Cat) {
    const next = !(c.is_visible !== false);
    await setCategoryVisible({ data: { id: c.id, is_visible: next } });
    qc.invalidateQueries({ queryKey: ["categories"] });
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
      <p className="text-sm text-muted-foreground">{tr.hint}</p>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h2 className="font-medium">{editing ? tr.editingTitle : tr.newTitle}</h2>
          <div className="space-y-2">
            <Label>{tr.name}</Label>
            <Input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr.namePlaceholder}
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
                .filter((c) => c.id !== editing?.id)
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
          {list.length === 0 && <p className="text-sm text-muted-foreground">{tr.empty}</p>}
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
    </div>
  );
}
