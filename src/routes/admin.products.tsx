import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/error-message";
import { confirmToast } from "@/lib/confirm-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components-ui/button";
import { Input } from "@/components-ui/input";
import { Label } from "@/components-ui/label";
import { Textarea } from "@/components-ui/textarea";
import {
  deleteProduct,
  getSignedUploadUrl,
  listCategoriesForProducts,
  listProducts,
  saveProduct,
} from "@/lib/products.functions";
import { listPaymentMethods } from "@/lib/payment-methods.functions";
import { filterCategoriesByQuery, getCategoryPath, sortCategoriesTree } from "@/lib/category-tree";
import { useAdminLocale } from "@/lib/admin-locale";
import type { Locale } from "@/lib/i18n";

export const Route = createFileRoute("/admin/products")({
  component: ProductsPage,
});

type Img = { id?: string; image_path: string; sort_order: number };
type MaterialFile = {
  id?: string;
  file_path: string;
  file_name: string | null;
  sort_order: number;
};
type Product = {
  id?: string;
  category_id: string | null;
  category_ids: string[];
  name: string;
  description: string;
  keywords: string;
  price: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
  file_path: string | null;
  file_name: string | null;
  file_path_kz?: string | null;
  file_name_kz?: string | null;
  file_url?: string | null;
  file_url_kz?: string | null;
  product_images?: Img[];
  product_material_files?: (MaterialFile & { language: "ru" | "kz" })[];
  country_prices?: Record<string, number>;
};

const empty: Product = {
  category_id: null,
  category_ids: [],
  name: "",
  description: "",
  keywords: "",
  price: 0,
  currency: "KZT",
  is_active: true,
  sort_order: 0,
  file_path: null,
  file_name: null,
  file_path_kz: null,
  file_name_kz: null,
  file_url: null,
  file_url_kz: null,
  product_images: [],
  country_prices: {},
};

// Карта расширений → MIME. Браузеры не знают тип для .7z и некоторых других
// архивов (отдают application/octet-stream), из-за чего Supabase с whitelist
// отклонял загрузку. Определяем тип по расширению файла.
const MIME_BY_EXT: Record<string, string> = {
  ".7z": "application/x-7z-compressed",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mimeForFile(filename: string, fallback?: string): string {
  const ext = (filename.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  return MIME_BY_EXT[ext] || fallback || "application/octet-stream";
}

// fetch() gives no upload progress at all — XMLHttpRequest does, via
// upload.onprogress, so the direct-to-Supabase PUT uses that instead.
async function uploadFile(
  file: File,
  bucket: "product-images" | "product-files",
  onProgress?: (percent: number) => void,
): Promise<{ path: string; name: string }> {
  // 1. Получаем одноразовую ссылку для прямой загрузки от сервера
  const { path, name, signedUrl } = await getSignedUploadUrl({
    data: { bucket, filename: file.name },
  });

  // 2. Грузим файл напрямую в Supabase в обход лимитов Vercel.
  // Для файлов товаров определяем Content-Type по расширению (надёжнее, чем
  // file.type, который пуст для .7z). Для картинок доверяем типу браузера.
  const contentType =
    bucket === "product-files"
      ? mimeForFile(file.name, file.type)
      : file.type || "application/octet-stream";

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.responseText || `Upload failed HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Ошибка сети при загрузке"));
    xhr.send(file);
  });

  return { path, name };
}

type UploadStatus = { label: string; index: number; total: number; percent: number };

async function uploadManyWithProgress(
  files: FileList,
  bucket: "product-images" | "product-files",
  setStatus: (s: UploadStatus | null) => void,
): Promise<{ path: string; name: string }[]> {
  const list = Array.from(files);
  const results: { path: string; name: string }[] = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const update = (percent: number) =>
        setStatus({ label: f.name, index: i + 1, total: list.length, percent });
      update(0);
      results.push(await uploadFile(f, bucket, update));
    }
  } finally {
    setStatus(null);
  }
  return results;
}

const copy: Record<
  Locale,
  {
    uploadingOf: (index: number, total: number, label: string, percent: number) => string;
    removeBtn: string;
    title: string;
    newProductBtn: string;
    editTitle: string;
    newTitle: string;
    name: string;
    categoriesLabel: string;
    categorySearchPlaceholder: string;
    hiddenInBot: string;
    noCategoriesAvailable: string;
    nothingFound: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    descriptionHint: string;
    keywordsLabel: string;
    price: string;
    currency: string;
    sortOrder: string;
    photosLabel: string;
    countryPricesTitle: string;
    countryPricesHint: string;
    autoPlaceholder: string;
    materialRuLabel: string;
    materialKzLabel: string;
    externalLinkRu: string;
    externalLinkKz: string;
    externalLinkHint: string;
    externalLinkPlaceholder: string;
    onlyRuHint: string;
    showInBot: string;
    save: string;
    saving: string;
    cancel: string;
    searchLabel: string;
    searchPlaceholder: string;
    foundCount: (found: number, total: number) => string;
    noProductsYet: string;
    hidden: string;
    noCategory: string;
    noFile: string;
    editShort: string;
    deleteShort: string;
    uploadPhotoError: (msg: string) => string;
    uploadFileError: (kzSuffix: string, msg: string) => string;
    kzSuffix: string;
    saveError: (msg: string) => string;
    deleteError: (msg: string) => string;
    unknownError: string;
    confirmDelete: string;
  }
> = {
  ru: {
    uploadingOf: (index, total, label, percent) =>
      `Загружаю ${index} из ${total}: ${label} — ${percent}%`,
    removeBtn: "Убрать",
    title: "Товары",
    newProductBtn: "+ Новый товар",
    editTitle: "Редактирование товара",
    newTitle: "Новый товар",
    name: "Название",
    categoriesLabel: "Категории (можно выбрать несколько)",
    categorySearchPlaceholder: "Поиск категории…",
    hiddenInBot: " (скрыта в боте)",
    noCategoriesAvailable: "Нет доступных категорий",
    nothingFound: "Ничего не найдено",
    descriptionLabel: "Описание (обязательно для модерации Robokassa)",
    descriptionPlaceholder: "Подробное описание материала для покупателя",
    descriptionHint: "Рекомендуется заполнить подробное описание товара/услуги.",
    keywordsLabel: "Ключевые слова (для поиска, через пробел или запятую)",
    price: "Цена",
    currency: "Валюта",
    sortOrder: "Порядок",
    photosLabel: "Фото (можно несколько)",
    countryPricesTitle: "Цены для разных стран (вручную)",
    countryPricesHint:
      "Если оставить поле пустым — будет работать автоматическая конвертация базовой цены.",
    autoPlaceholder: "Авто (по курсу)",
    materialRuLabel: "📄 Материал (Русский) — можно несколько файлов/фото",
    materialKzLabel: "📄 Материал (Қазақша) — можно несколько файлов/фото",
    externalLinkRu: "Или внешняя ссылка на файл (Русский)",
    externalLinkKz: "Или внешняя ссылка на файл (Қазақша)",
    externalLinkHint: "Ссылка используется, только если выше не загружено ни одного файла.",
    externalLinkPlaceholder: "https://drive.google.com/...",
    onlyRuHint:
      "Если загрузить материал только на русском, бот не будет спрашивать язык при выдаче заказа.",
    showInBot: "Показывать в боте",
    save: "Сохранить",
    saving: "Сохранение...",
    cancel: "Отмена",
    searchLabel: "🔍 Поиск по материалам",
    searchPlaceholder: "Название, ключевое слово или описание…",
    foundCount: (found, total) => `Найдено: ${found} из ${total}`,
    noProductsYet: "Пока нет товаров.",
    hidden: "(скрыт)",
    noCategory: "без категории",
    noFile: " · нет файла",
    editShort: "Изм.",
    deleteShort: "Удал.",
    uploadPhotoError: (msg) => `Ошибка загрузки фото: ${msg}`,
    uploadFileError: (kzSuffix, msg) => `Ошибка загрузки файла${kzSuffix}: ${msg}`,
    kzSuffix: " (KZ)",
    saveError: (msg) => `Ошибка сохранения: ${msg}`,
    deleteError: (msg) => `Ошибка удаления: ${msg}`,
    unknownError: "Неизвестная ошибка",
    confirmDelete: "Удалить товар?",
  },
  kk: {
    uploadingOf: (index, total, label, percent) =>
      `Жүктелуде ${index} / ${total}: ${label} — ${percent}%`,
    removeBtn: "Алып тастау",
    title: "Тауарлар",
    newProductBtn: "+ Жаңа тауар",
    editTitle: "Тауарды өңдеу",
    newTitle: "Жаңа тауар",
    name: "Атауы",
    categoriesLabel: "Санаттар (бірнешеуін таңдауға болады)",
    categorySearchPlaceholder: "Санатты іздеу…",
    hiddenInBot: " (ботта жасырын)",
    noCategoriesAvailable: "Қолжетімді санаттар жоқ",
    nothingFound: "Ештеңе табылмады",
    descriptionLabel: "Сипаттама (Robokassa модерациясы үшін міндетті)",
    descriptionPlaceholder: "Сатып алушыға арналған материалдың толық сипаттамасы",
    descriptionHint: "Тауар/қызметтің толық сипаттамасын толтыру ұсынылады.",
    keywordsLabel: "Кілт сөздер (іздеу үшін, бос орын немесе үтірмен)",
    price: "Баға",
    currency: "Валюта",
    sortOrder: "Реті",
    photosLabel: "Фото (бірнешеуін таңдауға болады)",
    countryPricesTitle: "Түрлі елдерге бағалар (қолмен)",
    countryPricesHint: "Өрісті бос қалдырсаңыз — негізгі бағаның автоматты айырбасы жұмыс істейді.",
    autoPlaceholder: "Авто (курс бойынша)",
    materialRuLabel: "📄 Материал (Орысша) — бірнеше файл/фото болуы мүмкін",
    materialKzLabel: "📄 Материал (Қазақша) — бірнеше файл/фото болуы мүмкін",
    externalLinkRu: "Немесе файлға сыртқы сілтеме (Орысша)",
    externalLinkKz: "Немесе файлға сыртқы сілтеме (Қазақша)",
    externalLinkHint: "Сілтеме тек жоғарыда бірде-бір файл жүктелмеген жағдайда қолданылады.",
    externalLinkPlaceholder: "https://drive.google.com/...",
    onlyRuHint: "Материал тек орыс тілінде жүктелсе, бот тапсырысты берген кезде тіл сұрамайды.",
    showInBot: "Ботта көрсету",
    save: "Сақтау",
    saving: "Сақталуда...",
    cancel: "Бас тарту",
    searchLabel: "🔍 Материалдар бойынша іздеу",
    searchPlaceholder: "Атауы, кілт сөз немесе сипаттама…",
    foundCount: (found, total) => `Табылды: ${found} / ${total}`,
    noProductsYet: "Әзірге тауарлар жоқ.",
    hidden: "(жасырын)",
    noCategory: "санатсыз",
    noFile: " · файл жоқ",
    editShort: "Өзг.",
    deleteShort: "Жою",
    uploadPhotoError: (msg) => `Фото жүктеу қатесі: ${msg}`,
    uploadFileError: (kzSuffix, msg) => `Файл жүктеу қатесі${kzSuffix}: ${msg}`,
    kzSuffix: " (KZ)",
    saveError: (msg) => `Сақтау қатесі: ${msg}`,
    deleteError: (msg) => `Жою қатесі: ${msg}`,
    unknownError: "Белгісіз қате",
    confirmDelete: "Тауарды жою керек пе?",
  },
  en: {
    uploadingOf: (index, total, label, percent) =>
      `Uploading ${index} of ${total}: ${label} — ${percent}%`,
    removeBtn: "Remove",
    title: "Products",
    newProductBtn: "+ New product",
    editTitle: "Editing product",
    newTitle: "New product",
    name: "Name",
    categoriesLabel: "Categories (multiple allowed)",
    categorySearchPlaceholder: "Search category…",
    hiddenInBot: " (hidden in the bot)",
    noCategoriesAvailable: "No categories available",
    nothingFound: "Nothing found",
    descriptionLabel: "Description (required for Robokassa moderation)",
    descriptionPlaceholder: "A detailed description of the material for the buyer",
    descriptionHint: "It's recommended to fill in a detailed product/service description.",
    keywordsLabel: "Keywords (for search, space- or comma-separated)",
    price: "Price",
    currency: "Currency",
    sortOrder: "Order",
    photosLabel: "Photos (multiple allowed)",
    countryPricesTitle: "Prices by country (manual)",
    countryPricesHint: "Leave a field empty to use automatic conversion from the base price.",
    autoPlaceholder: "Auto (by rate)",
    materialRuLabel: "📄 Material (Russian) — multiple files/photos allowed",
    materialKzLabel: "📄 Material (Kazakh) — multiple files/photos allowed",
    externalLinkRu: "Or an external file link (Russian)",
    externalLinkKz: "Or an external file link (Kazakh)",
    externalLinkHint: "The link is used only if no file has been uploaded above.",
    externalLinkPlaceholder: "https://drive.google.com/...",
    onlyRuHint:
      "If the material is only uploaded in Russian, the bot won't ask which language to deliver.",
    showInBot: "Show in the bot",
    save: "Save",
    saving: "Saving...",
    cancel: "Cancel",
    searchLabel: "🔍 Search materials",
    searchPlaceholder: "Name, keyword, or description…",
    foundCount: (found, total) => `Found: ${found} of ${total}`,
    noProductsYet: "No products yet.",
    hidden: "(hidden)",
    noCategory: "no category",
    noFile: " · no file",
    editShort: "Edit",
    deleteShort: "Delete",
    uploadPhotoError: (msg) => `Failed to upload photo: ${msg}`,
    uploadFileError: (kzSuffix, msg) => `Failed to upload file${kzSuffix}: ${msg}`,
    kzSuffix: " (KZ)",
    saveError: (msg) => `Save error: ${msg}`,
    deleteError: (msg) => `Delete error: ${msg}`,
    unknownError: "Unknown error",
    confirmDelete: "Delete this product?",
  },
  uz: {
    uploadingOf: (index, total, label, percent) =>
      `Yuklanmoqda ${index} / ${total}: ${label} — ${percent}%`,
    removeBtn: "Olib tashlash",
    title: "Mahsulotlar",
    newProductBtn: "+ Yangi mahsulot",
    editTitle: "Mahsulotni tahrirlash",
    newTitle: "Yangi mahsulot",
    name: "Nomi",
    categoriesLabel: "Kategoriyalar (bir nechtasini tanlash mumkin)",
    categorySearchPlaceholder: "Kategoriyani qidirish…",
    hiddenInBot: " (botda yashirin)",
    noCategoriesAvailable: "Mavjud kategoriyalar yo‘q",
    nothingFound: "Hech narsa topilmadi",
    descriptionLabel: "Tavsif (Robokassa moderatsiyasi uchun majburiy)",
    descriptionPlaceholder: "Xaridor uchun material haqida batafsil tavsif",
    descriptionHint: "Mahsulot/xizmatning batafsil tavsifini to‘ldirish tavsiya etiladi.",
    keywordsLabel: "Kalit so‘zlar (qidiruv uchun, probel yoki vergul bilan)",
    price: "Narx",
    currency: "Valyuta",
    sortOrder: "Tartib",
    photosLabel: "Fotolar (bir nechtasi mumkin)",
    countryPricesTitle: "Mamlakatlar bo‘yicha narxlar (qo‘lda)",
    countryPricesHint:
      "Maydonni bo‘sh qoldirsangiz — asosiy narxning avtomatik konvertatsiyasi ishlaydi.",
    autoPlaceholder: "Avto (kurs bo‘yicha)",
    materialRuLabel: "📄 Material (Ruscha) — bir nechta fayl/foto mumkin",
    materialKzLabel: "📄 Material (Qozoqcha) — bir nechta fayl/foto mumkin",
    externalLinkRu: "Yoki faylga tashqi havola (Ruscha)",
    externalLinkKz: "Yoki faylga tashqi havola (Qozoqcha)",
    externalLinkHint: "Havola faqat yuqorida birorta fayl yuklanmagan bo‘lsa ishlatiladi.",
    externalLinkPlaceholder: "https://drive.google.com/...",
    onlyRuHint: "Material faqat ruscha yuklansa, bot buyurtmani berishda tilni so‘ramaydi.",
    showInBot: "Botda ko‘rsatish",
    save: "Saqlash",
    saving: "Saqlanmoqda...",
    cancel: "Bekor qilish",
    searchLabel: "🔍 Materiallar bo‘yicha qidiruv",
    searchPlaceholder: "Nomi, kalit so‘z yoki tavsif…",
    foundCount: (found, total) => `Topildi: ${found} / ${total}`,
    noProductsYet: "Hozircha mahsulotlar yo‘q.",
    hidden: "(yashirin)",
    noCategory: "kategoriyasiz",
    noFile: " · fayl yo‘q",
    editShort: "Tahr.",
    deleteShort: "O‘chir.",
    uploadPhotoError: (msg) => `Fotoni yuklashda xato: ${msg}`,
    uploadFileError: (kzSuffix, msg) => `Faylni yuklashda xato${kzSuffix}: ${msg}`,
    kzSuffix: " (KZ)",
    saveError: (msg) => `Saqlash xatosi: ${msg}`,
    deleteError: (msg) => `O‘chirish xatosi: ${msg}`,
    unknownError: "Noma’lum xato",
    confirmDelete: "Mahsulotni o‘chirasizmi?",
  },
};

function UploadProgressBar({
  status,
  tr,
}: {
  status: UploadStatus | null;
  tr: (typeof copy)[Locale];
}) {
  if (!status) return null;
  return (
    <div className="space-y-1 mt-1">
      <div className="text-xs text-muted-foreground">
        {tr.uploadingOf(status.index, status.total, status.label, status.percent)}
      </div>
      <div className="h-1.5 w-full bg-muted rounded overflow-hidden">
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${status.percent}%` }}
        />
      </div>
    </div>
  );
}

function MaterialFilesList({
  files,
  onRemove,
  removeLabel,
}: {
  files: MaterialFile[];
  onRemove: (idx: number) => void;
  removeLabel: string;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="text-sm space-y-1 mt-1">
      {files.map((f, idx) => (
        <li
          key={`${f.file_path}-${idx}`}
          className="flex items-center justify-between gap-2 text-muted-foreground"
        >
          <span className="truncate">📎 {f.file_name || f.file_path}</span>
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="shrink-0 text-destructive hover:underline"
          >
            {removeLabel}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProductsPage() {
  const { locale } = useAdminLocale();
  const tr = copy[locale];
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: () => listProducts() });
  const cats = useQuery({ queryKey: ["cats-flat"], queryFn: () => listCategoriesForProducts() });

  const pMethods = useQuery({
    queryKey: ["payment-methods-admin"],
    queryFn: () => listPaymentMethods(),
  });

  // useMemo, а не голое приведение: без него (products.data ?? []) — новый
  // массив на каждый рендер, пока данные ещё грузятся, и useMemo на filtered
  // ниже пересчитывался бы всякий раз вхолостую.
  const list = useMemo(() => products.data ?? [], [products.data]);
  const [search, setSearch] = useState("");
  const [catQuery, setCatQuery] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [images, setImages] = useState<Img[]>([]);
  const [materialFilesRu, setMaterialFilesRu] = useState<MaterialFile[]>([]);
  const [materialFilesKz, setMaterialFilesKz] = useState<MaterialFile[]>([]);
  const [imagesUpload, setImagesUpload] = useState<UploadStatus | null>(null);
  const [materialsRuUpload, setMaterialsRuUpload] = useState<UploadStatus | null>(null);
  const [materialsKzUpload, setMaterialsKzUpload] = useState<UploadStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const catsTree = useMemo(() => sortCategoriesTree(cats.data ?? []), [cats.data]);
  const catsFiltered = useMemo(
    () => filterCategoriesByQuery(catsTree, catQuery),
    [catsTree, catQuery],
  );

  // Клиентская фильтрация по названию / ключевым словам / описанию.
  // 300+ товаров обрабатываются мгновенно, бэкенд-поиск не требуется.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => {
      const hay = [p.name, p.keywords, p.description].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [list, search]);

  function startNew() {
    setEditing({ ...empty });
    setImages([]);
    setMaterialFilesRu([]);
    setMaterialFilesKz([]);
  }
  function startEdit(p: (typeof list)[number]) {
    setEditing({
      id: p.id,
      category_id: p.category_id,
      category_ids: (p.category_ids as string[] | null) || (p.category_id ? [p.category_id] : []),
      name: p.name,
      description: p.description ?? "",
      keywords: p.keywords ?? "",
      price: Number(p.price),
      currency: p.currency,
      is_active: p.is_active,
      sort_order: p.sort_order,
      file_path: p.file_path,
      file_name: p.file_name,
      file_path_kz: p.file_path_kz,
      file_name_kz: p.file_name_kz,
      file_url: p.file_url,
      file_url_kz: p.file_url_kz,
      country_prices: (p.country_prices as Record<string, number> | null) || {},
    });
    const imgs = (p.product_images ?? [])
      .slice()
      .sort((a: Img, b: Img) => a.sort_order - b.sort_order);
    setImages(imgs);

    const materialRows = (p.product_material_files ?? []) as (MaterialFile & {
      language: "ru" | "kz";
    })[];
    const ru = materialRows
      .filter((f) => f.language === "ru")
      .sort((a, b) => a.sort_order - b.sort_order);
    const kz = materialRows
      .filter((f) => f.language === "kz")
      .sort((a, b) => a.sort_order - b.sort_order);
    // Products saved before multi-file materials existed only have the
    // single legacy file_path column — show that as one item so it stays
    // visible/editable instead of silently disappearing from the list.
    setMaterialFilesRu(
      ru.length
        ? ru
        : p.file_path
          ? [{ file_path: p.file_path, file_name: p.file_name, sort_order: 0 }]
          : [],
    );
    setMaterialFilesKz(
      kz.length
        ? kz
        : p.file_path_kz
          ? [{ file_path: p.file_path_kz, file_name: p.file_name_kz, sort_order: 0 }]
          : [],
    );
  }

  async function onImagesChange(files: FileList | null) {
    if (!files) return;
    try {
      const uploaded = await uploadManyWithProgress(files, "product-images", setImagesUpload);
      setImages([
        ...images,
        ...uploaded.map((r, i) => ({ image_path: r.path, sort_order: images.length + i })),
      ]);
    } catch (e: unknown) {
      toast.error(tr.uploadPhotoError(errorMessage(e)));
    }
  }

  async function onMaterialFilesChange(files: FileList | null, lang: "ru" | "kz") {
    if (!files) return;
    const setList = lang === "ru" ? setMaterialFilesRu : setMaterialFilesKz;
    const current = lang === "ru" ? materialFilesRu : materialFilesKz;
    const setStatus = lang === "ru" ? setMaterialsRuUpload : setMaterialsKzUpload;
    try {
      const uploaded = await uploadManyWithProgress(files, "product-files", setStatus);
      setList([
        ...current,
        ...uploaded.map((r, i) => ({
          file_path: r.path,
          file_name: r.name,
          sort_order: current.length + i,
        })),
      ]);
    } catch (e: unknown) {
      toast.error(tr.uploadFileError(lang === "kz" ? tr.kzSuffix : "", errorMessage(e)));
    }
  }

  async function onSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await saveProduct({
        data: {
          id: editing.id,
          category_id: editing.category_id,
          category_ids: editing.category_ids,
          name: editing.name,
          description: editing.description,
          keywords: editing.keywords,
          price: Number(editing.price),
          currency: editing.currency,
          is_active: editing.is_active,
          sort_order: Number(editing.sort_order),
          // The multi-file uploader below is now the source of truth for the
          // deliverable — legacy single-file columns are cleared on save.
          file_path: null,
          file_name: null,
          file_path_kz: null,
          file_name_kz: null,
          file_url: editing.file_url,
          file_url_kz: editing.file_url_kz,
          image_paths: images.map((i) => i.image_path),
          material_files_ru: materialFilesRu.map((f) => ({
            file_path: f.file_path,
            file_name: f.file_name,
          })),
          material_files_kz: materialFilesKz.map((f) => ({
            file_path: f.file_path,
            file_name: f.file_name,
          })),
          country_prices: editing.country_prices,
        },
      });
      setEditing(null);
      setImages([]);
      setMaterialFilesRu([]);
      setMaterialFilesKz([]);
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: unknown) {
      toast.error(tr.saveError(errorMessage(e) || tr.unknownError));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!(await confirmToast(tr.confirmDelete))) return;
    try {
      await deleteProduct({ data: { id } });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e: unknown) {
      toast.error(tr.deleteError(errorMessage(e) || tr.unknownError));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr.title}</h1>
        {!editing && <Button onClick={startNew}>{tr.newProductBtn}</Button>}
      </div>

      {editing ? (
        <div className="bg-card border rounded-lg p-4 space-y-4">
          <h2 className="font-medium">{editing.id ? tr.editTitle : tr.newTitle}</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{tr.name}</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.categoriesLabel}</Label>
              <Input
                value={catQuery}
                onChange={(e) => setCatQuery(e.target.value)}
                placeholder={tr.categorySearchPlaceholder}
              />
              <div className="border rounded-md p-2 max-h-56 overflow-y-auto space-y-1 bg-background text-sm">
                {catsFiltered.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editing.category_ids.includes(c.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditing({ ...editing, category_ids: [...editing.category_ids, c.id] });
                        } else {
                          setEditing({
                            ...editing,
                            category_ids: editing.category_ids.filter((id) => id !== c.id),
                          });
                        }
                      }}
                    />
                    <span>
                      {getCategoryPath(c.id, catsTree)}
                      {c.is_visible === false ? (
                        <span className="text-xs text-amber-700">{tr.hiddenInBot}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
                {catsFiltered.length === 0 && (
                  <div className="text-muted-foreground text-xs">
                    {catsTree.length === 0 ? tr.noCategoriesAvailable : tr.nothingFound}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{tr.descriptionLabel}</Label>
            <Textarea
              rows={4}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder={tr.descriptionPlaceholder}
            />
            {!editing.description.trim() && (
              <p className="text-xs text-amber-600">{tr.descriptionHint}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{tr.keywordsLabel}</Label>
            <Input
              value={editing.keywords}
              onChange={(e) => setEditing({ ...editing, keywords: e.target.value })}
            />
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{tr.price}</Label>
              <Input
                type="number"
                value={editing.price}
                onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.currency}</Label>
              <Input
                value={editing.currency}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr.sortOrder}</Label>
              <Input
                type="number"
                value={editing.sort_order}
                onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{tr.photosLabel}</Label>
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onImagesChange(e.target.files)}
            />
            <UploadProgressBar status={imagesUpload} tr={tr} />
            <div className="flex flex-wrap gap-2 mt-2">
              {images.map((im, idx) => (
                <div key={im.image_path} className="relative">
                  <img
                    src={`/api/public/img/${im.image_path}`}
                    alt=""
                    className="w-20 h-20 object-cover rounded border"
                  />
                  <button
                    type="button"
                    onClick={() => setImages(images.filter((_, i) => i !== idx))}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full w-5 h-5 text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {pMethods.data && pMethods.data.length > 0 && (
            <div className="space-y-4 pt-4 border-t">
              <h3 className="font-medium">{tr.countryPricesTitle}</h3>
              <p className="text-xs text-muted-foreground">{tr.countryPricesHint}</p>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pMethods.data.map((m) => (
                  <div key={m.country_code} className="space-y-2">
                    <Label>
                      {m.country_name} ({m.currency})
                    </Label>
                    <Input
                      type="number"
                      placeholder={tr.autoPlaceholder}
                      value={editing.country_prices?.[m.country_code] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        const newPrices = { ...editing.country_prices };
                        if (val === "") {
                          delete newPrices[m.country_code];
                        } else {
                          newPrices[m.country_code] = Number(val);
                        }
                        setEditing({ ...editing, country_prices: newPrices });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 pt-4 border-t">
            <Label htmlFor="file-ru">{tr.materialRuLabel}</Label>
            <Input
              id="file-ru"
              type="file"
              multiple
              disabled={!!materialsRuUpload}
              onChange={(e) => onMaterialFilesChange(e.target.files, "ru")}
            />
            <UploadProgressBar status={materialsRuUpload} tr={tr} />
            <MaterialFilesList
              files={materialFilesRu}
              onRemove={(idx) => setMaterialFilesRu(materialFilesRu.filter((_, i) => i !== idx))}
              removeLabel={tr.removeBtn}
            />
            <div className="pt-2">
              <Label>{tr.externalLinkRu}</Label>
              <Input
                value={editing.file_url || ""}
                onChange={(e) => setEditing({ ...editing, file_url: e.target.value || null })}
                placeholder={tr.externalLinkPlaceholder}
              />
              <p className="text-xs text-muted-foreground mt-1">{tr.externalLinkHint}</p>
            </div>
          </div>

          <div className="space-y-2 pt-4 border-t">
            <Label htmlFor="file-kz">{tr.materialKzLabel}</Label>
            <Input
              id="file-kz"
              type="file"
              multiple
              disabled={!!materialsKzUpload}
              onChange={(e) => onMaterialFilesChange(e.target.files, "kz")}
            />
            <UploadProgressBar status={materialsKzUpload} tr={tr} />
            <MaterialFilesList
              files={materialFilesKz}
              onRemove={(idx) => setMaterialFilesKz(materialFilesKz.filter((_, i) => i !== idx))}
              removeLabel={tr.removeBtn}
            />
            <div className="pt-2">
              <Label>{tr.externalLinkKz}</Label>
              <Input
                value={editing.file_url_kz || ""}
                onChange={(e) => setEditing({ ...editing, file_url_kz: e.target.value || null })}
                placeholder={tr.externalLinkPlaceholder}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{tr.onlyRuHint}</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.is_active}
              onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
            />
            {tr.showInBot}
          </label>

          <div className="flex gap-2">
            <Button onClick={onSave} disabled={saving}>
              {saving ? tr.saving : tr.save}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tr.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-card border rounded-lg p-4 space-y-3">
            <Label>{tr.searchLabel}</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr.searchPlaceholder}
            />
            <p className="text-xs text-muted-foreground">
              {tr.foundCount(filtered.length, list.length)}
            </p>
          </div>
          <div className="bg-card border rounded-lg divide-y">
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                {list.length === 0 ? tr.noProductsYet : tr.nothingFound}
              </div>
            )}
            {filtered.map((p) => (
              <div key={p.id} className="p-3 flex items-center gap-3">
                {p.product_images?.[0] ? (
                  <img
                    src={`/api/public/img/${p.product_images[0].image_path}`}
                    className="w-12 h-12 object-cover rounded border shrink-0"
                    alt=""
                  />
                ) : (
                  <div className="w-12 h-12 bg-muted rounded shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {p.name}{" "}
                    {!p.is_active && (
                      <span className="text-xs text-muted-foreground">{tr.hidden}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.category_ids && (p.category_ids as string[]).length > 0
                      ? (p.category_ids as string[])
                          .map((id) => getCategoryPath(id, catsTree))
                          .filter(Boolean)
                          .join(", ") || tr.noCategory
                      : p.categories?.name || tr.noCategory}{" "}
                    · {p.price} {p.currency}
                    {(() => {
                      const materials = (p.product_material_files ?? []) as {
                        language: "ru" | "kz";
                      }[];
                      const hasRu =
                        materials.some((f) => f.language === "ru") || !!p.file_path || !!p.file_url;
                      const hasKz =
                        materials.some((f) => f.language === "kz") ||
                        !!p.file_path_kz ||
                        !!p.file_url_kz;
                      if (!hasRu && !hasKz)
                        return <span className="text-destructive">{tr.noFile}</span>;
                      if (hasRu && hasKz) return <span className="text-green-500"> · 🇷🇺🇰🇿</span>;
                      if (hasRu) return <span className="text-muted-foreground"> · 🇷🇺</span>;
                      return <span className="text-muted-foreground"> · 🇰🇿</span>;
                    })()}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                    {tr.editShort}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => onDelete(p.id)}>
                    {tr.deleteShort}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
