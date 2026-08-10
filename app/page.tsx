"use client";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogProduct } from "./catalog-types";
type MajorCategory =
  | "职业体验 / Career Experience"
  | "生活场景 / Lifestyle Scene"
  | "零售 / Retail"
  | "农牧生活 / Agro-pastoral Life"
  | "动物世界 / Animal World"
  | "车生活 / Car Life"
  | "拼装手工 / Assemble by Hand"
  | "机械传动 / Playground Scenes"
  | "多媒体互动 / Multimedia Interactivity";
type NavigationMajor = MajorCategory | "农牧生活 / 动物世界";
type NavigationGroup = "all" | "simulation" | "toys";
type Override = {
  productId: string;
  name?: string | null;
  price?: string | null;
  imageUrl?: string | null;
  volume?: string | null;
  stock?: number | null;
  majorCategory?: MajorCategory | null;
  category1?: string | null;
  category2?: string | null;
  category3?: string | null;
  colorTag?: string | null;
  hasScreen?: boolean;
  isRecommended?: boolean;
};
type Category = {
  id: string;
  level: number;
  parentKey: string;
  name: string;
};
type Product = CatalogProduct & {
  volume: string;
  stock: number | null;
  majorCategory: MajorCategory;
  category1: string;
  category2: string;
  category3: string;
  colorTag: string;
  hasScreen: boolean;
  isRecommended: boolean;
  relatedIds: string[];
};
type KitchenGroupSource = "main" | "addons" | "manual";
type KitchenSelectionMode = "single" | "multiple" | "repeatable";
type KitchenPackageGroup = {
  id: string;
  name: string;
  source: KitchenGroupSource;
  selectionMode: KitchenSelectionMode;
  minSelections: number;
  maxSelections: number;
  itemMin: number;
  itemMax: number;
  productIds: string[];
};
type KitchenPackage = {
  id: string;
  name: string;
  description: string;
  groups: KitchenPackageGroup[];
};
type KitchenPackageRecord = {
  id: string;
  name: string;
  description: string;
  configJson: string;
};
const majorCategories: MajorCategory[] = [
  "职业体验 / Career Experience",
  "生活场景 / Lifestyle Scene",
  "零售 / Retail",
  "农牧生活 / Agro-pastoral Life",
  "动物世界 / Animal World",
  "车生活 / Car Life",
  "拼装手工 / Assemble by Hand",
  "机械传动 / Playground Scenes",
  "多媒体互动 / Multimedia Interactivity",
];
const navigationMajors: NavigationMajor[] = [
  "职业体验 / Career Experience",
  "生活场景 / Lifestyle Scene",
  "零售 / Retail",
  "农牧生活 / 动物世界",
  "车生活 / Car Life",
  "拼装手工 / Assemble by Hand",
  "机械传动 / Playground Scenes",
  "多媒体互动 / Multimedia Interactivity",
];
const navigationMajorMembers = (major: NavigationMajor): MajorCategory[] =>
  major === "农牧生活 / 动物世界"
    ? ["农牧生活 / Agro-pastoral Life", "动物世界 / Animal World"]
    : [major];
const majorCategoryByArea: Record<string, MajorCategory> = {
  消防区设备: "职业体验 / Career Experience",
  消防站区域配套玩具: "职业体验 / Career Experience",
  医院区域配套玩具: "职业体验 / Career Experience",
  医院区域英文版配套玩具: "职业体验 / Career Experience",
  医院区模拟设备: "职业体验 / Career Experience",
  未来医院区域配套玩具: "职业体验 / Career Experience",
  "未来医院区域配套玩具（英文版）": "职业体验 / Career Experience",
  警察局区域配套玩具: "职业体验 / Career Experience",
  "警察、工地设备": "职业体验 / Career Experience",
  "工程、工地区域配套玩具": "职业体验 / Career Experience",
  航空区设备: "职业体验 / Career Experience",
  厨房区域配套玩具: "生活场景 / Lifestyle Scene",
  厨房区模拟设备: "生活场景 / Lifestyle Scene",
  未来厨房区域配套玩具: "生活场景 / Lifestyle Scene",
  未来厨房区域英文版配套玩具: "生活场景 / Lifestyle Scene",
  未来厨房区模拟设备: "生活场景 / Lifestyle Scene",
  超市区域配套玩具: "生活场景 / Lifestyle Scene",
  超市区域英文版配套玩具: "生活场景 / Lifestyle Scene",
  超市区模拟设备: "生活场景 / Lifestyle Scene",
  未来超市区域配套玩具: "生活场景 / Lifestyle Scene",
  未来超市区域英文版配套玩具: "生活场景 / Lifestyle Scene",
  未来超市区模拟设备: "生活场景 / Lifestyle Scene",
  熟食区域配套玩具: "生活场景 / Lifestyle Scene",
  烘焙区域配套玩具: "生活场景 / Lifestyle Scene",
  甜品屋区域配套玩具: "生活场景 / Lifestyle Scene",
  奶茶区配套玩具: "生活场景 / Lifestyle Scene",
  "火锅、烧烤、烤鸭、面馆区模拟设备": "生活场景 / Lifestyle Scene",
  "甜品、面包房、寿司区模拟设备": "生活场景 / Lifestyle Scene",
  BABY区域配套玩具: "生活场景 / Lifestyle Scene",
  育婴室区域配套玩具: "生活场景 / Lifestyle Scene",
  洗衣房区域配套玩具: "生活场景 / Lifestyle Scene",
  阅读区域配套玩具: "生活场景 / Lifestyle Scene",
  "公主房、化妆间区域配套玩具": "生活场景 / Lifestyle Scene",
  化妆区模拟设备: "生活场景 / Lifestyle Scene",
  花店区域配套玩具: "生活场景 / Lifestyle Scene",
  桌面游戏区域配套玩具: "生活场景 / Lifestyle Scene",
  舞台区域配套玩具: "生活场景 / Lifestyle Scene",
  "(定制LOGO+0.27/双/定码定色/单码单色1000起，250双清箱)":
    "零售 / Retail",
  牧场区: "农牧生活 / Agro-pastoral Life",
  牧场区域配套玩具: "农牧生活 / Agro-pastoral Life",
  母鸡生蛋区域配套玩具: "农牧生活 / Agro-pastoral Life",
  种植采摘区域配套玩具: "农牧生活 / Agro-pastoral Life",
  果蔬采摘区域配套玩具: "农牧生活 / Agro-pastoral Life",
  鱼池区域配套玩具: "农牧生活 / Agro-pastoral Life",
  "宠物医院、宠物之家区域配套玩具": "动物世界 / Animal World",
  "宠物医院、宠物之家区域配套玩具（英文版）": "动物世界 / Animal World",
  "萌宠、沐浴区模拟设备": "动物世界 / Animal World",
  恐龙区设备: "动物世界 / Animal World",
  赛车区域配套玩具: "车生活 / Car Life",
  "赛车、修车区模拟设备": "车生活 / Car Life",
  修理店区域配套玩具: "车生活 / Car Life",
  洗车区: "车生活 / Car Life",
  洗车区域配套玩具: "车生活 / Car Life",
  排雷区设备: "拼装手工 / Assemble by Hand",
  沙池区域配套玩具: "拼装手工 / Assemble by Hand",
  沙池区设备: "拼装手工 / Assemble by Hand",
  "积木、KTV设备": "拼装手工 / Assemble by Hand",
  "摩天轮、旋转木马、小火车设备": "机械传动 / Playground Scenes",
  小球运动与水科技: "机械传动 / Playground Scenes",
  多媒体互动类: "多媒体互动 / Multimedia Interactivity",
  数字体育运动: "多媒体互动 / Multimedia Interactivity",
  VR设备: "多媒体互动 / Multimedia Interactivity",
  "攀岩、运动区": "多媒体互动 / Multimedia Interactivity",
};
const getMajorCategory = (p: CatalogProduct): MajorCategory =>
  majorCategoryByArea[p.category] || "生活场景 / Lifestyle Scene";
const kitchenPackageTemplate: KitchenPackage = {
  id: "kitchen-flexible-package",
  name: "厨房区 · 自由配置套餐",
  description: "先选主设备，再按需搭配附件玩具；价格与库存实时引用独立 SKU。",
  groups: [
    {
      id: "kitchen-main",
      name: "主产品 / Main product",
      source: "main",
      selectionMode: "single",
      minSelections: 1,
      maxSelections: 1,
      itemMin: 1,
      itemMax: 1,
      productIds: [],
    },
    {
      id: "kitchen-addons",
      name: "附件玩具 / Add-on toys",
      source: "addons",
      selectionMode: "multiple",
      minSelections: 0,
      maxSelections: 6,
      itemMin: 0,
      itemMax: 1,
      productIds: [],
    },
  ],
};
const colorOptions = [
  "浅红",
  "红",
  "深红",
  "浅橙",
  "橙",
  "深橙",
  "浅黄",
  "黄",
  "深黄",
  "浅绿",
  "绿",
  "深绿",
  "浅青",
  "青",
  "深青",
  "浅蓝",
  "蓝",
  "深蓝",
  "浅紫",
  "紫",
  "深紫",
  "黑",
  "白",
];
const colorSwatches: Record<string, string> = {
  浅红: "#ef9a9a", 红: "#d83d48", 深红: "#852532",
  浅橙: "#f5bb7b", 橙: "#e9812f", 深橙: "#a94a17",
  浅黄: "#f3e58d", 黄: "#ddbd26", 深黄: "#9a7211",
  浅绿: "#9fd59a", 绿: "#3f9862", 深绿: "#1d5a43",
  浅青: "#92dbe0", 青: "#2fa5ad", 深青: "#17646d",
  浅蓝: "#9bcbed", 蓝: "#2f7eb9", 深蓝: "#174b86",
  浅紫: "#c8a7e6", 紫: "#8756b6", 深紫: "#513177",
  黑: "#1c242d", 白: "#ffffff",
};
const screenWords = /屏|screen|投影|多媒体|互动|vr|电视|监视/i;
const money = (value: number | null, currency: "CNY" | "USD") => {
  if (value === null) return "待确认";
  const amount = new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-US", {
    minimumFractionDigits: currency === "CNY" ? 0 : 2,
    maximumFractionDigits: currency === "CNY" ? 0 : 2,
  }).format(value);
  return currency === "CNY" ? `CNY ¥${amount}` : `USD $${amount}`;
};
const quoteArea = (p: Product) => {
  const x = `${p.category2} ${p.name}`;
  if (/厨房|烘焙|奶茶|火锅|烧烤|烤鸭|面馆|甜品|熟食/.test(x))
    return "厨房区域 / Kitchen Area";
  if (/超市|果蔬|种植|采摘/.test(x)) return "超市区域 / Supermarket Area";
  if (/医院|育婴/.test(x)) return "医院区域 / Hospital Area";
  if (/宠物/.test(x)) return "宠物区域 / Pet Area";
  if (/赛车|修车|洗车|修理/.test(x)) return "交通模拟区域 / Transport Area";
  if (/消防|警察/.test(x)) return "城市职业区域 / City Careers Area";
  if (/公主|化妆|花店/.test(x)) return "生活体验区域 / Lifestyle Area";
  if (/牧场|母鸡|鱼池/.test(x)) return "自然探索区域 / Nature Area";
  return `${p.category2 || p.category1} / Experience Area`;
};
function Visual({ p, mini = false }: { p: Product; mini?: boolean }) {
  return p.image ? (
    <img src={p.image} alt={mini ? "" : p.name} loading="lazy" />
  ) : (
    <span className="productFallback">{p.category2.slice(0, 4)}</span>
  );
}
function CompanyLogo({ className = "" }: { className?: string }) {
  return (
    <img
      className={`companyLogo ${className}`}
      src="/brand/yifun-life-logo.png"
      alt="亦玩集团 Yifun Life"
    />
  );
}
function autoColor(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 72;
      const x = c.getContext("2d");
      if (!x) return resolve("未识别");
      x.drawImage(img, 0, 0, 72, 72);
      const pixels = x.getImageData(0, 0, 72, 72).data;
      const size = 72;
      const isBackground = new Uint8Array(size * size);
      const queue: number[] = [];
      const hsvAt = (index: number) => {
        const r = pixels[index * 4] / 255;
        const g = pixels[index * 4 + 1] / 255;
        const b = pixels[index * 4 + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        const hue =
          delta === 0
            ? 0
            : ((max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta) *
                60 +
                360) %
              360;
        return { hue, saturation: max === 0 ? 0 : delta / max, value: max };
      };
      const isBlank = (index: number) => {
        const { saturation, value } = hsvAt(index);
        return pixels[index * 4 + 3] < 120 || (value > 0.94 && saturation < 0.08);
      };
      for (let y = 0; y < size; y++)
        for (const xPos of [0, size - 1]) {
          const index = y * size + xPos;
          if (isBlank(index) && !isBackground[index]) {
            isBackground[index] = 1;
            queue.push(index);
          }
        }
      for (let xPos = 0; xPos < size; xPos++)
        for (const y of [0, size - 1]) {
          const index = y * size + xPos;
          if (isBlank(index) && !isBackground[index]) {
            isBackground[index] = 1;
            queue.push(index);
          }
        }
      while (queue.length) {
        const index = queue.pop()!;
        const xPos = index % size;
        const y = Math.floor(index / size);
        for (const next of [index - 1, index + 1, index - size, index + size]) {
          if (
            next >= 0 &&
            next < size * size &&
            Math.abs((next % size) - xPos) + Math.abs(Math.floor(next / size) - y) === 1 &&
            !isBackground[next] &&
            isBlank(next)
          ) {
            isBackground[next] = 1;
            queue.push(next);
          }
        }
      }
      const counts: Record<string, number> = {};
      const brightness: Record<string, number> = {};
      let counted = 0;
      for (let index = 0; index < size * size; index++) {
        if (isBackground[index] || pixels[index * 4 + 3] < 120) continue;
        const { hue, saturation, value } = hsvAt(index);
        const color =
          value < 0.2
            ? "黑"
            : value > 0.82 && saturation < 0.18
              ? "白"
              : saturation < 0.14
                ? ""
                : hue < 18 || hue >= 345
                  ? "红"
                  : hue < 48
                    ? "橙"
                    : hue < 72
                      ? "黄"
                      : hue < 165
                        ? "绿"
                        : hue < 195
                          ? "青"
                          : hue < 260
                            ? "蓝"
                            : "紫";
        if (!color) continue;
        counts[color] = (counts[color] || 0) + 1;
        brightness[color] = (brightness[color] || 0) + value;
        counted++;
      }
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const [main, mainCount] = ranked[0] || [];
      const secondCount = ranked[1]?.[1] || 0;
      if (!main || !mainCount || mainCount / counted <= 0.3 || secondCount >= mainCount * 0.5)
        return resolve("未识别");
      if (main === "黑" || main === "白") return resolve(main);
      const averageBrightness = brightness[main] / mainCount;
      resolve(`${averageBrightness >= 0.72 ? "浅" : averageBrightness <= 0.42 ? "深" : ""}${main}`);
    };
    img.onerror = () => resolve("未识别");
    img.src = src;
  });
}
export default function Home() {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [relations, setRelations] = useState<
    {
      productId: string;
      relatedProductId: string;
    }[]
  >([]);
  const [kitchenPackageRecords, setKitchenPackageRecords] = useState<
    KitchenPackageRecord[]
  >([]);
  const [storedCatalogProducts, setStoredCatalogProducts] = useState<
    CatalogProduct[]
  >([]);
  const [kitchenMode, setKitchenMode] = useState<
    "packages" | "main" | "addons"
  >("packages");
  const [packageSelections, setPackageSelections] = useState<
    Record<string, number>
  >({});
  const [packageManagerOpen, setPackageManagerOpen] = useState(false);
  const [packageDraft, setPackageDraft] = useState<KitchenPackage>(
    kitchenPackageTemplate,
  );
  const [packageNotice, setPackageNotice] = useState("");
  const [auth, setAuth] = useState<"checking" | "signedOut" | "signedIn">(
    "checking",
  );
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [categoryFamily, setCategoryFamily] = useState("小玩具");
  const [activeMajor, setActiveMajor] = useState<NavigationMajor>(
    navigationMajors[0],
  );
  const [expandedMajors, setExpandedMajors] = useState<Set<NavigationMajor>>(
    () => new Set([navigationMajors[0]]),
  );
  const [category, setCategory] = useState("全部产品");
  const [navigationGroup, setNavigationGroup] =
    useState<NavigationGroup>("simulation");
  const [expandedProductGroups, setExpandedProductGroups] = useState<
    Set<string>
  >(() =>
    new Set(
      navigationMajors.flatMap((major) => [
        `${major}:simulation`,
        `${major}:toys`,
      ]),
    ),
  );
  const [query, setQuery] = useState("");
  const [colorFilter, setColorFilter] = useState("全部颜色");
  const [screenOnly, setScreenOnly] = useState(false);
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [currency, setCurrency] = useState<"CNY" | "USD">("CNY");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [editor, setEditor] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryLevel, setCategoryLevel] = useState(2);
  const [categoryParent, setCategoryParent] = useState("");
  const [relatedSearch, setRelatedSearch] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteProject, setQuoteProject] = useState("");
  const [designerName, setDesignerName] = useState("");
  const [salesName, setSalesName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [installationIncludesTravel, setInstallationIncludesTravel] =
    useState(true);
  const [showDesignDeduction, setShowDesignDeduction] = useState(false);
  const [fees, setFees] = useState({
    packaging: 0,
    formaldehyde: 0,
    shipping: 0,
    installation: 0,
    designDeduction: 0,
  });
  const colorScanInFlight = useRef(new Set<string>());
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setAuth(d.authenticated ? "signedIn" : "signedOut"))
      .catch(() => setAuth("signedOut"));
  }, []);
  useEffect(() => {
    if (auth !== "signedIn") return;
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setStoredCatalogProducts(d.products || []);
          setOverrides(d.overrides);
          setCategories(d.categories);
          setRelations(d.recommendations);
          setKitchenPackageRecords(d.packages || []);
        }
      })
      .catch(() => undefined);
  }, [auth]);
  const products = useMemo<Product[]>(
    () =>
      storedCatalogProducts.map((p) => {
        const o = overrides.find((x) => x.productId === p.id);
        const image = o?.imageUrl || p.image;
        const category1 = o?.category1 || p.family;
        return {
          ...p,
          name: o?.name || p.name,
          price:
            o?.price === undefined || o.price === null || o.price === ""
              ? p.price
              : Number(o.price),
          image,
          volume: o?.volume || "",
          stock: o?.stock ?? null,
          majorCategory: o?.majorCategory || getMajorCategory(p),
          category1,
          category2: o?.category2 || p.category,
          category3: o?.category3 || "未细分",
          colorTag:
            category1 === "小玩具"
              ? "不适用"
              : !image
                ? "无主图"
                : category1 === "模拟设备"
                  ? o?.colorTag || "待重新识别"
                  : o?.colorTag || "未识别",
          hasScreen:
            o?.hasScreen ??
            screenWords.test(`${p.name} ${p.spec} ${p.category}`),
          isRecommended: o?.isRecommended ?? false,
          relatedIds: relations
            .filter((r) => r.productId === p.id)
            .map((r) => r.relatedProductId),
        };
      }),
    [overrides, relations, storedCatalogProducts],
  );
  useEffect(() => {
    const slots = 6 - colorScanInFlight.current.size;
    if (slots <= 0) return;
    products
      .filter(
        (p) =>
          p.category1 === "模拟设备" &&
          p.colorTag === "待重新识别" &&
          p.image &&
          !colorScanInFlight.current.has(p.id),
      )
      .slice(0, slots)
      .forEach((p) => {
        colorScanInFlight.current.add(p.id);
        autoColor(p.image).then((colorTag) => {
          colorScanInFlight.current.delete(p.id);
          void fetch("/api/catalog", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: p.id, patch: { colorTag } }),
          });
          setOverrides((current) => {
            const existing = current.find((o) => o.productId === p.id);
            return [
              ...current.filter((o) => o.productId !== p.id),
              { ...existing, productId: p.id, colorTag },
            ];
          });
        });
      });
  }, [products]);
  const level2 = [
    ...new Set(
      products
        .filter((p) => p.category1 === categoryFamily)
        .map((p) => p.category2),
    ),
  ];
  const majorProducts = products.filter((p) =>
    navigationMajorMembers(activeMajor).includes(p.majorCategory),
  );
  const isLifestyleMajor = activeMajor === "生活场景 / Lifestyle Scene";
  const isKitchenView =
    isLifestyleMajor && category === "厨房专区";
  const kitchenProducts = products.filter(
    (p) =>
      p.majorCategory === "生活场景 / Lifestyle Scene" &&
      /厨房/.test(p.category2),
  );
  const kitchenMainProducts = kitchenProducts.filter(
    (p) => p.category1 !== "小玩具",
  );
  const kitchenAddonProducts = kitchenProducts.filter(
    (p) => p.category1 === "小玩具",
  );
  const savedKitchenPackages = kitchenPackageRecords.flatMap((record) => {
    try {
      return [
        {
          ...JSON.parse(record.configJson),
          id: record.id,
          name: record.name,
          description: record.description,
        } as KitchenPackage,
      ];
    } catch {
      return [];
    }
  });
  const kitchenPackages = savedKitchenPackages.length
    ? savedKitchenPackages
    : [kitchenPackageTemplate];
  const visible = [...(
    isKitchenView
      ? kitchenMode === "main"
        ? kitchenMainProducts
        : kitchenMode === "addons"
          ? kitchenAddonProducts
          : []
      : majorProducts
  )]
    .filter(
    (p) =>
      (category === "全部产品" || p.category2 === category) &&
      (navigationGroup === "all" ||
        (navigationGroup === "simulation" && p.category1 !== "小玩具") ||
        (navigationGroup === "toys" && p.category1 === "小玩具")) &&
      (!query ||
        `${p.sku}${p.name}${p.en}${p.majorCategory}${p.category1}${p.category2}${p.category3}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (colorFilter === "全部颜色" || p.colorTag === colorFilter) &&
      (!screenOnly || p.hasScreen) &&
      (!recommendedOnly || p.isRecommended),
    )
    .sort(
      (a, b) =>
        Number(a.category1 === "小玩具") - Number(b.category1 === "小玩具"),
    );
  const grouped = Object.entries(
    visible.reduce<Record<string, Product[]>>((a, p) => {
      (a[p.category2] ||= []).push(p);
      return a;
    }, {}),
  );
  const catalogTitle =
    query
      ? `“${query}” 的结果`
      : category === "全部产品" && navigationGroup === "simulation"
        ? "模拟区"
        : category === "全部产品" && navigationGroup === "toys"
          ? "配套玩具"
          : category;
  const cartItems = products
    .filter((p) => cart[p.id])
    .map((p) => ({ ...p, qty: cart[p.id] }));
  const displayPrice = (p: Product) => (currency === "CNY" ? p.price : p.usd);
  const subtotal = cartItems.reduce(
    (n, p) => n + (displayPrice(p) || 0) * p.qty,
    0,
  );
  const quoteGroups = Object.entries(
    cartItems.reduce<Record<string, typeof cartItems>>((a, p) => {
      const area = quoteArea(p);
      (a[area] ||= []).push(p);
      return a;
    }, {}),
  );
  const preTax =
    subtotal +
    fees.packaging +
    fees.formaldehyde +
    fees.shipping +
    fees.installation;
  const tax = currency === "CNY" ? preTax * 0.13 : 0;
  const totalWithTax =
    preTax + tax - (showDesignDeduction ? fees.designDeduction : 0);
  const add = (id: string) =>
    setCart((x) => ({ ...x, [id]: (x[id] || 0) + 1 }));
  const packageProducts = (group: KitchenPackageGroup) =>
    group.source === "main"
      ? kitchenMainProducts
      : group.source === "addons"
        ? kitchenAddonProducts
        : kitchenProducts.filter((p) => group.productIds.includes(p.id));
  const selectionKey = (
    packageId: string,
    groupId: string,
    productId: string,
  ) => `${packageId}:${groupId}:${productId}`;
  const setPackageSelection = (
    packageId: string,
    group: KitchenPackageGroup,
    productId: string,
    nextQty: number,
  ) => {
    const key = selectionKey(packageId, group.id, productId);
    const groupKeys = packageProducts(group).map((p) =>
      selectionKey(packageId, group.id, p.id),
    );
    setPackageSelections((current) => {
      const next = { ...current };
      if (group.selectionMode === "single" && nextQty > 0)
        groupKeys.forEach((x) => delete next[x]);
      if (nextQty <= 0) delete next[key];
      else
        next[key] = Math.max(
          group.itemMin || 1,
          Math.min(group.itemMax || 1, nextQty),
        );
      return next;
    });
    setPackageNotice("");
  };
  const addPackageToQuote = (pack: KitchenPackage) => {
    const issues = pack.groups.flatMap((group) => {
      const chosen = packageProducts(group).filter(
        (p) =>
          (packageSelections[selectionKey(pack.id, group.id, p.id)] || 0) > 0,
      ).length;
      return chosen < group.minSelections || chosen > group.maxSelections
        ? [
            `${group.name} 需选择 ${group.minSelections}–${group.maxSelections} 项`,
          ]
        : [];
    });
    if (issues.length) {
      setPackageNotice(issues.join("；"));
      return;
    }
    setCart((current) => {
      const next = { ...current };
      pack.groups.forEach((group) =>
        packageProducts(group).forEach((p) => {
          const qty =
            packageSelections[selectionKey(pack.id, group.id, p.id)] || 0;
          if (qty) next[p.id] = (next[p.id] || 0) + qty;
        }),
      );
      return next;
    });
    setPackageNotice(
      `${pack.name} 已加入报价清单，SKU 仍以独立产品价格与库存为准。`,
    );
  };
  const saveKitchenPackage = async () => {
    const record = {
      id: packageDraft.id || crypto.randomUUID(),
      name: packageDraft.name || "未命名厨房套餐",
      description: packageDraft.description,
      configJson: JSON.stringify({
        ...packageDraft,
        id: undefined,
        name: undefined,
        description: undefined,
      }),
      updatedAt: "",
    };
    const response = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "kitchenPackage", package: record }),
    });
    if (response.ok) {
      setKitchenPackageRecords((records) => [
        ...records.filter((x) => x.id !== record.id),
        record,
      ]);
      setPackageManagerOpen(false);
      setPackageNotice("厨房套餐设置已保存。");
    }
  };
  const openEditor = async (p: Product) => {
    setEditor(p);
    setDraft(p);
    if (
      p.category1 === "模拟设备" &&
      p.colorTag === "待重新识别" &&
      p.image &&
      !colorScanInFlight.current.has(p.id)
    )
      setDraft((x) => (x ? { ...x, colorTag: "识别中…" } : x)),
        autoColor(p.image).then((colorTag) =>
          setDraft((x) => (x ? { ...x, colorTag } : x)),
        );
  };
  const save = async () => {
    if (!draft) return;
    const patch = {
      name: draft.name,
      price: draft.price === null ? "" : String(draft.price),
      imageUrl: draft.image,
      volume: draft.volume,
      stock: draft.stock,
      majorCategory: draft.majorCategory,
      category1: draft.category1,
      category2: draft.category2,
      category3: draft.category3,
      colorTag: draft.colorTag,
      hasScreen: draft.hasScreen,
      isRecommended: draft.isRecommended,
    };
    await fetch("/api/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: draft.id, patch }),
    });
    await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "recommendations",
        productId: draft.id,
        relatedIds: draft.relatedIds,
      }),
    });
    setOverrides((x) => [
      ...x.filter((o) => o.productId !== draft.id),
      { productId: draft.id, ...patch },
    ]);
    setRelations((x) => [
      ...x.filter((r) => r.productId !== draft.id),
      ...draft.relatedIds.map((relatedProductId) => ({
        productId: draft.id,
        relatedProductId,
      })),
    ]);
    setEditor(null);
  };
  const upload = async (file: File) => {
    if (!draft) return;
    const form = new FormData();
    form.set("productId", draft.id);
    form.set("file", file);
    const r = await fetch("/api/catalog/image", { method: "POST", body: form });
    const d = await r.json();
    if (d.imageUrl) {
      setDraft({ ...draft, image: d.imageUrl });
      if (draft.category1 === "模拟设备")
        autoColor(d.imageUrl).then((colorTag) =>
          setDraft((x) => (x ? { ...x, image: d.imageUrl, colorTag } : x)),
        );
    }
  };
  const createCategory = async () => {
    if (!categoryName.trim()) return;
    const c = {
      id: crypto.randomUUID(),
      level: categoryLevel,
      parentKey: categoryParent,
      name: categoryName.trim(),
      createdAt: new Date().toISOString(),
    };
    const r = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "category", category: c }),
    });
    if (r.ok) {
      setCategories((x) => [...x, c]);
      setCategoryName("");
    }
  };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: loginUsername,
        password: loginPassword,
      }),
    });
    if (r.ok) {
      setLoginPassword("");
      setAuth("signedIn");
    } else {
      const d = await r.json().catch(() => ({}));
      setLoginError(d.error || "登录失败，请重试");
    }
  };
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuth("signedOut");
  };
  if (auth === "checking")
    return (
      <main className="loginShell">
        <div className="loginCard">
          <CompanyLogo className="loginLogo" />
          <p>正在验证访问权限…</p>
        </div>
      </main>
    );
  if (auth === "signedOut")
    return (
      <main className="loginShell">
        <form className="loginCard" onSubmit={login}>
          <div className="loginBrand">
            <CompanyLogo className="loginLogo" />
          </div>
          <span className="eyebrow">PRIVATE ACCESS</span>
          <h1>登录产品报价系统</h1>
          <p>请输入账户与密码后继续。</p>
          <label>
            账户 / Account
            <input
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            密码 / Password
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {loginError && <div className="loginError">{loginError}</div>}
          <button className="primary" type="submit">
            登录 / Sign in
          </button>
          <small className="loginHint">
            为保护报价信息，登录 30 分钟后将自动退出。
          </small>
        </form>
      </main>
    );
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#">
          <CompanyLogo className="headerLogo" />
        </a>
        <div className="topActions">
          <label className="search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称、款号、分类"
            />
          </label>
          <button
            className="currency"
            onClick={() => setCurrency((x) => (x === "CNY" ? "USD" : "CNY"))}
            aria-label="切换报价货币"
          >
            {currency === "CNY" ? "人民币 ¥" : "USD $"}
          </button>
          <button
            className="outline"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            筛选器
          </button>
          <button className="outline" onClick={() => setManageOpen(true)}>
            分类管理
          </button>
          <button className="cartButton" onClick={() => setCartOpen(true)}>
            <span>报价清单</span>
            <b>{cartItems.length}</b>
          </button>
        </div>
      </header>
      <section className={`workspace${editor ? " editorOpen" : ""}`}>
        <aside className="sidebar">
          <div className="sideIntro">
            <span>PRODUCT LIBRARY · 2026</span>
            <h1>
              产品库
              <br />
              与方案编辑
            </h1>
            <p>
              八大类为一级目录；点击任意 SKU
              可维护主图、价格、分类、标签和常用搭配。
            </p>
          </div>
          <nav>
            {navigationMajors.map((major, i) => {
              const expanded = expandedMajors.has(major);
              return (
                <div
                  className={`navGroup ${activeMajor === major ? "selected" : ""}`}
                  key={major}
                >
                <button
                  className="navHead"
                  onClick={() => {
                    if (expanded && activeMajor === major) {
                      setExpandedMajors((current) => {
                        const next = new Set(current);
                        next.delete(major);
                        return next;
                      });
                    } else {
                      if (!expanded)
                        setExpandedMajors((current) =>
                          new Set(current).add(major),
                        );
                      setActiveMajor(major);
                      setCategory("全部产品");
                      setNavigationGroup("simulation");
                    }
                  }}
                >
                  <span className="navIndex">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="navText">
                    <b>
                      {major === "农牧生活 / 动物世界"
                        ? major
                        : major.split(" / ")[0]}
                    </b>
                    <small>
                      {major === "农牧生活 / 动物世界"
                        ? "Agro-pastoral Life · Animal World"
                        : major.split(" / ")[1]} ·{" "}
                      {
                        products.filter((p) =>
                          navigationMajorMembers(major).includes(p.majorCategory),
                        ).length
                      }{" "}
                      项
                    </small>
                  </span>
                  <span className="chevron">
                    {expanded ? "−" : "+"}
                  </span>
                </button>
                {expanded && (
                  <div className="subnav">
                    {([
                        ...(major === "生活场景 / Lifestyle Scene"
                          ? [
                              {
                                key: "packages" as const,
                                name: "套餐 / Packages",
                                matches: () => false,
                              },
                            ]
                          : []),
                        {
                          key: "simulation" as const,
                          name: "模拟区",
                          matches: (p: Product) => p.category1 !== "小玩具",
                        },
                        {
                          key: "toys" as const,
                          name: "配套玩具",
                          matches: (p: Product) => p.category1 === "小玩具",
                        },
                      ]).map((section) => {
                        const isPackageSection = section.key === "packages";
                        const sectionProducts = products.filter(
                          (p) =>
                            navigationMajorMembers(major).includes(
                              p.majorCategory,
                            ) && section.matches(p),
                        );
                        const sectionCategories = [
                          ...new Set(sectionProducts.map((p) => p.category2)),
                        ];
                        const sectionKey = `${major}:${section.key}`;
                        const sectionExpanded = expandedProductGroups.has(sectionKey);
                        return (
                          <div className="subnavGroup" key={section.key}>
                            <div
                              className={
                                (isPackageSection && category === "厨房专区") ||
                                (!isPackageSection &&
                                  category === "全部产品" &&
                                  navigationGroup === section.key)
                                  ? "subnavGroupHead on"
                                  : "subnavGroupHead"
                              }
                            >
                              <button
                                className="subnavGroupSelect"
                                onClick={() => {
                                  if (isPackageSection) {
                                    setCategory("厨房专区");
                                    setKitchenMode("packages");
                                    setNavigationGroup("all");
                                  } else {
                                    setCategory("全部产品");
                                    setNavigationGroup(section.key);
                                  }
                                }}
                              >
                                <b>{section.name}</b>
                                <span>
                                  {isPackageSection
                                    ? kitchenPackages.length
                                    : sectionProducts.length}
                                </span>
                              </button>
                              {!isPackageSection && (
                                <button
                                  className="subnavGroupToggle"
                                  aria-label={`${
                                    sectionExpanded ? "收起" : "展开"
                                  }${section.name}`}
                                  onClick={() =>
                                    setExpandedProductGroups((current) => {
                                      const next = new Set(current);
                                      if (next.has(sectionKey)) next.delete(sectionKey);
                                      else next.add(sectionKey);
                                      return next;
                                    })
                                  }
                                >
                                  {sectionExpanded ? "−" : "+"}
                                </button>
                              )}
                            </div>
                            {!isPackageSection &&
                              sectionExpanded &&
                              sectionCategories.map((c) => (
                              <button
                                className={category === c ? "on" : ""}
                                onClick={() => {
                                  setCategory(c);
                                  setNavigationGroup(section.key);
                                }}
                                key={c}
                              >
                                {c}
                                <span>
                                  {
                                    sectionProducts.filter(
                                      (p) => p.category2 === c,
                                    ).length
                                  }
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
              );
            })}
          </nav>
          <div className="sideFoot">
            <span className="statusDot" /> 已归类 SKU <b>{products.length}</b>
            <small>八大类映射已写入产品库</small>
          </div>
        </aside>
        <section className="catalog">
          <div className="catalogHead">
            <div>
              <span className="eyebrow">
                {activeMajor} ·{" "}
                {isKitchenView ? kitchenProducts.length : visible.length} ITEMS
              </span>
              <h2>{catalogTitle}</h2>
              <p>
                {isKitchenView
                  ? "套餐与单点互不影响；套餐成员直接引用独立 SKU 的名称、价格与库存。"
                  : "一级目录依据 2026 产品册；点击产品卡片打开 SKU 编辑抽屉，黄色按钮将产品加入报价单。"}
              </p>
            </div>
          </div>
          {isKitchenView && (
            <div className="kitchenTabs">
              <div className="kitchenModeTabs">
                <button
                  className={kitchenMode === "packages" ? "on" : ""}
                  onClick={() => setKitchenMode("packages")}
                >
                  套餐 / Packages
                </button>
                <button
                  className={kitchenMode === "main" ? "on" : ""}
                  onClick={() => setKitchenMode("main")}
                >
                  主产品 / Main products
                </button>
                <button
                  className={kitchenMode === "addons" ? "on" : ""}
                  onClick={() => setKitchenMode("addons")}
                >
                  附件玩具 / Add-on toys
                </button>
              </div>
              <button
                className="outline"
                onClick={() => {
                  setPackageDraft(kitchenPackages[0]);
                  setPackageManagerOpen(true);
                }}
              >
                管理厨房套餐
              </button>
            </div>
          )}
          {filtersOpen && (
            <div className="filterBar">
              <b>关联常用推荐筛选</b>
              <select
                value={colorFilter}
                onChange={(e) => setColorFilter(e.target.value)}
              >
                <option>全部颜色</option>
                {colorOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={screenOnly}
                  onChange={(e) => setScreenOnly(e.target.checked)}
                />{" "}
                仅看带屏幕 / 投影
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={recommendedOnly}
                  onChange={(e) => setRecommendedOnly(e.target.checked)}
                />{" "}
                仅看常用推荐
              </label>
              <button
                onClick={() => {
                  setColorFilter("全部颜色");
                  setScreenOnly(false);
                  setRecommendedOnly(false);
                }}
              >
                清除
              </button>
            </div>
          )}
          {isKitchenView && kitchenMode === "packages" ? (
            <section className="packageCatalog">
              {kitchenPackages.map((pack) => (
                <article className="packageCard" key={pack.id}>
                  <div className="packageCardHead">
                    <div>
                      <span>FLEXIBLE PACKAGE</span>
                      <h3>{pack.name}</h3>
                      <p>{pack.description}</p>
                    </div>
                    <button
                      className="outline"
                      onClick={() => {
                        setPackageDraft(pack);
                        setPackageManagerOpen(true);
                      }}
                    >
                      配置套餐
                    </button>
                  </div>
                  <div className="packageGroups">
                    {pack.groups.map((group) => {
                      const groupProducts = packageProducts(group);
                      const selected = groupProducts.filter(
                        (p) =>
                          (packageSelections[
                            selectionKey(pack.id, group.id, p.id)
                          ] || 0) > 0,
                      ).length;
                      return (
                        <section className="packageGroup" key={group.id}>
                          <div className="packageGroupTitle">
                            <div>
                              <b>{group.name}</b>
                              <small>
                                {group.selectionMode === "single"
                                  ? "单选"
                                  : group.selectionMode === "multiple"
                                    ? "多选"
                                    : "可复选"}{" "}
                                · 每组 {group.minSelections}–
                                {group.maxSelections} 项
                              </small>
                            </div>
                            <span>
                              {selected} / {group.maxSelections}
                            </span>
                          </div>
                          <div className="packageSkuGrid">
                            {groupProducts.map((p) => {
                              const key = selectionKey(pack.id, group.id, p.id);
                              const qty = packageSelections[key] || 0;
                              const maxReached =
                                selected >= group.maxSelections && qty === 0;
                              return (
                                <div
                                  className={`packageSku ${qty ? "chosen" : ""}`}
                                  key={p.id}
                                >
                                  <div className="packageSkuImage">
                                    <Visual p={p} mini />
                                  </div>
                                  <div className="packageSkuInfo">
                                    <b>{p.name}</b>
                                    <small>
                                      {p.sku} ·{" "}
                                      {money(displayPrice(p), currency)}
                                    </small>
                                    <small>
                                      库存：
                                      {p.stock === null ? "待维护" : p.stock}
                                    </small>
                                  </div>
                                  {group.selectionMode === "repeatable" &&
                                  qty > 0 ? (
                                    <div className="packageQty">
                                      <button
                                        onClick={() =>
                                          setPackageSelection(
                                            pack.id,
                                            group,
                                            p.id,
                                            qty - 1,
                                          )
                                        }
                                      >
                                        −
                                      </button>
                                      <b>{qty}</b>
                                      <button
                                        disabled={qty >= group.itemMax}
                                        onClick={() =>
                                          setPackageSelection(
                                            pack.id,
                                            group,
                                            p.id,
                                            qty + 1,
                                          )
                                        }
                                      >
                                        ＋
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      className="chooseButton"
                                      disabled={maxReached}
                                      onClick={() =>
                                        setPackageSelection(
                                          pack.id,
                                          group,
                                          p.id,
                                          qty ? 0 : Math.max(group.itemMin, 1),
                                        )
                                      }
                                    >
                                      {qty
                                        ? "已选"
                                        : group.selectionMode === "single"
                                          ? "选择"
                                          : "加入"}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  {packageNotice && (
                    <p
                      className={
                        packageNotice.includes("需选择")
                          ? "packageError"
                          : "packageNotice"
                      }
                    >
                      {packageNotice}
                    </p>
                  )}
                  <div className="packageCardFoot">
                    <span>
                      套餐合计：
                      {money(
                        pack.groups.reduce(
                          (sum, group) =>
                            sum +
                            packageProducts(group).reduce(
                              (sub, p) =>
                                sub +
                                (displayPrice(p) || 0) *
                                  (packageSelections[
                                    selectionKey(pack.id, group.id, p.id)
                                  ] || 0),
                              0,
                            ),
                          0,
                        ),
                        currency,
                      )}
                    </span>
                    <button
                      className="primary"
                      onClick={() => addPackageToQuote(pack)}
                    >
                      加入套餐至报价单
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : (
            grouped.map(([name, items]) => (
              <section className="categoryBlock" key={name}>
                <div className="categoryTitle">
                  <span>
                    <b>{name}</b>
                    <small>{items.length} 项</small>
                  </span>
                </div>
                <div className="productGrid">
                  {items.map((p) => (
                    <article
                      className="productCard editableCard"
                      key={p.id}
                      onClick={() => openEditor(p)}
                    >
                      <div className="productImage">
                        <Visual p={p} />
                        {p.hasScreen && (
                          <em className="screenBadge">▣ 带屏幕</em>
                        )}
                        <span>{p.category3}</span>
                      </div>
                      <div className="productBody">
                        <div className="sku">
                          {p.sku} · {p.brand || "YIFUN"}
                        </div>
                        <h3>{p.name}</h3>
                        <p className="en">{p.en || "产品详情见规格说明"}</p>
                        {(p.category1 !== "小玩具" || p.isRecommended) && (
                          <div className="tagRow">
                            {p.category1 !== "小玩具" && (
                              <>
                                <i
                                  className="colorDot"
                                  style={{ background: colorSwatches[p.colorTag] }}
                                ></i>
                                <small>
                                  {p.colorTag === "无主图"
                                    ? "待上传主图"
                                    : p.colorTag === "待重新识别"
                                      ? "等待重新识别"
                                      : p.colorTag === "未识别"
                                      ? "待识别主色"
                                      : p.colorTag}
                                </small>
                              </>
                            )}
                            {p.isRecommended && (
                              <small className="recommendTag">常用推荐</small>
                            )}
                          </div>
                        )}
                        <div className="priceRow">
                          <div>
                            <small>参考单价 / {p.unit}</small>
                            <strong>{money(displayPrice(p), currency)}</strong>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              add(p.id);
                            }}
                          >
                            {cart[p.id] ? `已选 ${cart[p.id]}` : "＋ 添加"}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
          {!visible.length && (
            <div className="empty">
              <b>没有符合条件的产品</b>
              <p>换一个筛选条件试试。</p>
            </div>
          )}
        </section>
      </section>
      {editor && draft && (
        <div className="overlay editorOverlay">
          <aside className="editorDrawer">
            <div className="drawerHead">
              <div>
                <span>SKU EDITOR</span>
                <h2>{draft.sku}</h2>
              </div>
              <button onClick={() => setEditor(null)}>×</button>
            </div>
            <div className="editorBody">
              <div className="editHero">
                <Visual p={draft} />
                <label className="uploadButton">
                  更换主图
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      e.target.files?.[0] && upload(e.target.files[0])
                    }
                  />
                </label>
              </div>
              <section className="editSection">
                <h3>基础信息 / Basic information</h3>
                <label>
                  产品名称 / Product name
                  <input
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  参考价格（人民币） / CNY price
                  <input
                    type="number"
                    value={draft.price ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        price:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  体积 / Volume
                  <input
                    value={draft.volume}
                    onChange={(e) =>
                      setDraft({ ...draft, volume: e.target.value })
                    }
                    placeholder="例如：0.35 CBM"
                  />
                </label>
                <label>
                  库存 / Stock
                  <input
                    type="number"
                    min="0"
                    value={draft.stock ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        stock:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="留空表示待维护"
                  />
                </label>
              </section>
              <section className="editSection">
                <h3>分类层级 / Classification</h3>
                <p>
                  一级大目录来自 2026
                  产品册；产品大类、区域与三级分类会继续保留。
                </p>
                <div className="fourCols">
                  <label>
                    一级大目录
                    <select
                      value={draft.majorCategory}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          majorCategory: e.target.value as MajorCategory,
                        })
                      }
                    >
                      {majorCategories.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    产品大类
                    <select
                      value={draft.category1}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          category1: e.target.value,
                          category2: "",
                          category3: "未细分",
                        })
                      }
                    >
                      {["小玩具", "模拟设备", "大型设备"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    区域分类
                    <select
                      value={draft.category2}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          category2: e.target.value,
                          category3: "未细分",
                        })
                      }
                    >
                      {[
                        ...new Set([
                          ...products
                            .filter((p) => p.category1 === draft.category1)
                            .map((p) => p.category2),
                          ...categories
                            .filter(
                              (c) =>
                                c.level === 2 &&
                                c.parentKey === draft.category1,
                            )
                            .map((c) => c.name),
                        ]),
                      ].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    三级分类
                    <select
                      value={draft.category3}
                      onChange={(e) =>
                        setDraft({ ...draft, category3: e.target.value })
                      }
                    >
                      <option>未细分</option>
                      {categories
                        .filter(
                          (c) =>
                            c.level === 3 &&
                            c.parentKey ===
                              `${draft.category1}/${draft.category2}`,
                        )
                        .map((c) => (
                          <option key={c.id}>{c.name}</option>
                        ))}
                    </select>
                  </label>
                </div>
              </section>
              <section className="editSection">
                <h3>识别标签</h3>
                {draft.category1 === "小玩具" ? (
                  <p className="muted">配套小玩具无需识别主色。</p>
                ) : !draft.image ? (
                  <p className="muted">请先上传主图，系统会自动识别主色。</p>
                ) : (
                  <div className="tagOptions">
                    {colorOptions.map((c) => (
                      <button
                        key={c}
                        className={draft.colorTag === c ? "selectedTag" : ""}
                        onClick={() => setDraft({ ...draft, colorTag: c })}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                <label className="checkLine">
                  <input
                    type="checkbox"
                    checked={draft.hasScreen}
                    onChange={(e) =>
                      setDraft({ ...draft, hasScreen: e.target.checked })
                    }
                  />{" "}
                  在产品图片右上角显示“带屏幕”标记
                </label>
                <label className="checkLine">
                  <input
                    type="checkbox"
                    checked={draft.isRecommended}
                    onChange={(e) =>
                      setDraft({ ...draft, isRecommended: e.target.checked })
                    }
                  />{" "}
                  设为常用推荐产品
                </label>
              </section>
              <section className="editSection">
                <h3>关联常用搭配</h3>
                <input
                  placeholder="搜索并关联常用搭配 SKU"
                  value={relatedSearch}
                  onChange={(e) => setRelatedSearch(e.target.value)}
                />{" "}
                <div className="relatedList">
                  {products
                    .filter(
                      (p) =>
                        p.id !== draft.id &&
                        (!relatedSearch ||
                          `${p.sku}${p.name}`.includes(relatedSearch)),
                    )
                    .slice(0, 8)
                    .map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={draft.relatedIds.includes(p.id)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              relatedIds: e.target.checked
                                ? [...draft.relatedIds, p.id]
                                : draft.relatedIds.filter((x) => x !== p.id),
                            })
                          }
                        />{" "}
                        {p.sku} · {p.name}
                      </label>
                    ))}
                </div>
              </section>
            </div>
            <div className="editorFoot">
              <button className="outline" onClick={() => setEditor(null)}>
                取消
              </button>
              <button className="primary" onClick={save}>
                保存 SKU 修改
              </button>
            </div>
          </aside>
        </div>
      )}
      {manageOpen && (
        <div className="overlay">
          <aside className="managerDrawer">
            <div className="drawerHead">
              <div>
                <span>TAXONOMY</span>
                <h2>分类管理</h2>
              </div>
              <button onClick={() => setManageOpen(false)}>×</button>
            </div>
            <div className="editorBody">
              <p className="muted">
                一级大目录已固定为《2026产品册》的八大类。可在这里维护产品大类下的区域分类与三级分类。
              </p>
              <label>
                产品大类
                <select
                  value={categoryFamily}
                  onChange={(e) => {
                    setCategoryFamily(e.target.value);
                    setCategoryParent("");
                  }}
                >
                  {["小玩具", "模拟设备", "大型设备"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                分类层级
                <select
                  value={categoryLevel}
                  onChange={(e) => setCategoryLevel(Number(e.target.value))}
                >
                  <option value={2}>二级分类</option>
                  <option value={3}>三级分类</option>
                </select>
              </label>
              <label>
                父级
                <select
                  value={categoryParent}
                  onChange={(e) => setCategoryParent(e.target.value)}
                >
                  <option value="">请选择父级</option>
                  {categoryLevel === 2
                    ? [categoryFamily].map((x) => <option key={x}>{x}</option>)
                    : level2.map((x) => (
                        <option key={x} value={`${categoryFamily}/${x}`}>
                          {categoryFamily} / {x}
                        </option>
                      ))}
                </select>
              </label>
              <label>
                分类名称
                <input
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  placeholder={
                    categoryLevel === 2
                      ? "例如：节日主题玩具"
                      : "例如：海洋蓝主题"
                  }
                />
              </label>
              <button className="primary wide" onClick={createCategory}>
                新增分类
              </button>
              <div className="taxonomyList">
                {categories.map((c) => (
                  <div key={c.id}>
                    <small>
                      第 {c.level} 级 · {c.parentKey || "根"}
                    </small>
                    <b>{c.name}</b>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
      {packageManagerOpen && (
        <div className="overlay">
          <aside className="packageManagerDrawer">
            <div className="drawerHead">
              <div>
                <span>KITCHEN PACKAGE BUILDER</span>
                <h2>厨房套餐配置</h2>
              </div>
              <button onClick={() => setPackageManagerOpen(false)}>×</button>
            </div>
            <div className="editorBody">
              <p className="muted">
                套餐只保存引用规则，不复制产品资料；名称、价格和库存始终从独立
                SKU 读取。
              </p>
              <label>
                套餐名称 / Package name
                <input
                  value={packageDraft.name}
                  onChange={(e) =>
                    setPackageDraft({ ...packageDraft, name: e.target.value })
                  }
                />
              </label>
              <label>
                套餐说明 / Description
                <input
                  value={packageDraft.description}
                  onChange={(e) =>
                    setPackageDraft({
                      ...packageDraft,
                      description: e.target.value,
                    })
                  }
                />
              </label>
              {packageDraft.groups.map((group, index) => (
                <section className="packageRule" key={group.id}>
                  <div className="packageRuleHead">
                    <b>选项组 {index + 1}</b>
                    <button
                      onClick={() =>
                        setPackageDraft({
                          ...packageDraft,
                          groups: packageDraft.groups.filter(
                            (x) => x.id !== group.id,
                          ),
                        })
                      }
                    >
                      移除
                    </button>
                  </div>
                  <label>
                    组名称
                    <input
                      value={group.name}
                      onChange={(e) =>
                        setPackageDraft({
                          ...packageDraft,
                          groups: packageDraft.groups.map((x) =>
                            x.id === group.id
                              ? { ...x, name: e.target.value }
                              : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <div className="twoCols">
                    <label>
                      来源
                      <select
                        value={group.source}
                        onChange={(e) =>
                          setPackageDraft({
                            ...packageDraft,
                            groups: packageDraft.groups.map((x) =>
                              x.id === group.id
                                ? {
                                    ...x,
                                    source: e.target
                                      .value as KitchenGroupSource,
                                    productIds:
                                      e.target.value === "manual"
                                        ? x.productIds
                                        : [],
                                  }
                                : x,
                            ),
                          })
                        }
                      >
                        <option value="main">厨房主产品（自动同步）</option>
                        <option value="addons">厨房附件玩具（自动同步）</option>
                        <option value="manual">手动选择 SKU</option>
                      </select>
                    </label>
                    <label>
                      选择方式
                      <select
                        value={group.selectionMode}
                        onChange={(e) =>
                          setPackageDraft({
                            ...packageDraft,
                            groups: packageDraft.groups.map((x) =>
                              x.id === group.id
                                ? {
                                    ...x,
                                    selectionMode: e.target
                                      .value as KitchenSelectionMode,
                                  }
                                : x,
                            ),
                          })
                        }
                      >
                        <option value="single">单选</option>
                        <option value="multiple">多选</option>
                        <option value="repeatable">可复选（可加数量）</option>
                      </select>
                    </label>
                  </div>
                  <div className="fourNumberCols">
                    <label>
                      每组最少
                      <input
                        type="number"
                        min="0"
                        value={group.minSelections}
                        onChange={(e) =>
                          setPackageDraft({
                            ...packageDraft,
                            groups: packageDraft.groups.map((x) =>
                              x.id === group.id
                                ? {
                                    ...x,
                                    minSelections: Number(e.target.value) || 0,
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      每组最多
                      <input
                        type="number"
                        min="1"
                        value={group.maxSelections}
                        onChange={(e) =>
                          setPackageDraft({
                            ...packageDraft,
                            groups: packageDraft.groups.map((x) =>
                              x.id === group.id
                                ? {
                                    ...x,
                                    maxSelections: Math.max(
                                      1,
                                      Number(e.target.value) || 1,
                                    ),
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      每款最少
                      <input
                        type="number"
                        min="0"
                        value={group.itemMin}
                        onChange={(e) =>
                          setPackageDraft({
                            ...packageDraft,
                            groups: packageDraft.groups.map((x) =>
                              x.id === group.id
                                ? { ...x, itemMin: Number(e.target.value) || 0 }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      每款最多
                      <input
                        type="number"
                        min="1"
                        value={group.itemMax}
                        onChange={(e) =>
                          setPackageDraft({
                            ...packageDraft,
                            groups: packageDraft.groups.map((x) =>
                              x.id === group.id
                                ? {
                                    ...x,
                                    itemMax: Math.max(
                                      1,
                                      Number(e.target.value) || 1,
                                    ),
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <small className="ruleHint">
                    {group.source === "main"
                      ? `已自动关联 ${kitchenMainProducts.length} 个厨房主产品`
                      : group.source === "addons"
                        ? `已自动关联 ${kitchenAddonProducts.length} 个厨房附件玩具`
                        : "请选择参与这个选项组的 SKU。"}
                  </small>
                  {group.source === "manual" && (
                    <div className="manualSkuList">
                      {kitchenProducts.map((p) => (
                        <label key={p.id}>
                          <input
                            type="checkbox"
                            checked={group.productIds.includes(p.id)}
                            onChange={(e) =>
                              setPackageDraft({
                                ...packageDraft,
                                groups: packageDraft.groups.map((x) =>
                                  x.id === group.id
                                    ? {
                                        ...x,
                                        productIds: e.target.checked
                                          ? [...x.productIds, p.id]
                                          : x.productIds.filter(
                                              (id) => id !== p.id,
                                            ),
                                      }
                                    : x,
                                ),
                              })
                            }
                          />{" "}
                          {p.sku} · {p.name}
                          <small>
                            {money(displayPrice(p), currency)} · 库存{" "}
                            {p.stock === null ? "待维护" : p.stock}
                          </small>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              ))}
              <button
                className="outline wide"
                onClick={() =>
                  setPackageDraft({
                    ...packageDraft,
                    groups: [
                      ...packageDraft.groups,
                      {
                        id: crypto.randomUUID(),
                        name: "新的选项组",
                        source: "manual",
                        selectionMode: "multiple",
                        minSelections: 0,
                        maxSelections: 1,
                        itemMin: 0,
                        itemMax: 1,
                        productIds: [],
                      },
                    ],
                  })
                }
              >
                ＋ 添加选项组
              </button>
            </div>
            <div className="editorFoot">
              <button
                className="outline"
                onClick={() => setPackageManagerOpen(false)}
              >
                取消
              </button>
              <button className="primary" onClick={saveKitchenPackage}>
                保存套餐配置
              </button>
            </div>
          </aside>
        </div>
      )}
      {cartOpen && (
        <div className="overlay">
          <aside className="drawer">
            <div className="drawerHead">
              <div>
                <span>YOUR SELECTION · {currency}</span>
                <h2>报价清单</h2>
              </div>
              <button onClick={() => setCartOpen(false)}>×</button>
            </div>
            <div className="drawerContent">
              {cartItems.map((p) => (
                <div className="cartItem" key={p.id}>
                  <div className="cartImage">
                    <Visual p={p} mini />
                  </div>
                  <div className="cartInfo">
                    <b>{p.name}</b>
                    <small>{p.sku}</small>
                    <strong>
                      {money(
                        displayPrice(p) === null
                          ? null
                          : displayPrice(p)! * p.qty,
                        currency,
                      )}
                    </strong>
                  </div>
                  <div className="qty">
                    <button
                      onClick={() =>
                        setCart((x) => ({
                          ...x,
                          [p.id]: Math.max(0, p.qty - 1),
                        }))
                      }
                    >
                      −
                    </button>
                    <span>{p.qty}</span>
                    <button onClick={() => add(p.id)}>＋</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="drawerFoot">
              <div className="summary">
                <span>共 {cartItems.length} 项</span>
                <b>{money(subtotal, currency)}</b>
              </div>
              <button
                className="primary wide"
                onClick={() => {
                  setCartOpen(false);
                  setQuoteOpen(true);
                }}
              >
                生成报价单
              </button>
            </div>
          </aside>
        </div>
      )}
      {quoteOpen && (
        <div className="quoteOverlay">
          <div className="quoteShell">
            <div className="quoteToolbar">
              <b>报价清单已生成 / Quotation ready · {currency}</b>
              <div>
                <button className="outline" onClick={() => setQuoteOpen(false)}>
                  返回编辑 / Back
                </button>
                <button className="primary" onClick={() => window.print()}>
                  导出 PDF / Export PDF
                </button>
              </div>
            </div>
            <article className="quotePaper quotePaperWide">
              <header className="quoteHeader">
                <div className="quoteBrand">
                  <CompanyLogo className="quoteLogo" />
                </div>
                <div>
                  <span>QUOTATION · {currency}</span>
                  <h1>产品报价清单 / Product Quotation</h1>
                </div>
              </header>
              <section className="quoteMeta">
                <div>
                  <label>项目名称 / Project</label>
                  <input
                    value={quoteProject}
                    onChange={(e) => setQuoteProject(e.target.value)}
                    placeholder="请输入项目名称"
                  />
                </div>
                <div>
                  <label>设计师名称 / Designer</label>
                  <input
                    value={designerName}
                    onChange={(e) => setDesignerName(e.target.value)}
                    placeholder="请输入设计师名称"
                  />
                </div>
                <div>
                  <label>业务员名称 / Sales</label>
                  <input
                    value={salesName}
                    onChange={(e) => setSalesName(e.target.value)}
                    placeholder="请输入业务员名称"
                  />
                </div>
                <div>
                  <label>报价币种 / Currency</label>
                  <b>{currency === "USD" ? "美元 / USD" : "人民币 / CNY"}</b>
                </div>
                <div>
                  <label>报价日期 / Date</label>
                  <b>{new Date().toLocaleDateString("zh-CN")}</b>
                </div>
                <div>
                  <label>报价产品 / Items</label>
                  <b>{cartItems.length} 项 / Items</b>
                </div>
                <div className="addressInput">
                  <label>公司地址（页尾） / Company address (footer)</label>
                  <input
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                    placeholder="请输入公司地址"
                  />
                </div>
              </section>
              <section className="quoteLead">
                <h2>亦玩集团产品报价清单 / Yifun Life Product Quotation</h2>
                <p>
                  产品按体验区域归类；同一区域的玩具与模拟设备会汇总在一起。 /
                  Products are grouped by experience area.
                </p>
              </section>
              <table className="quoteTable">
                <thead>
                  <tr>
                    <th>序号 / No.</th>
                    <th>款号 / SKU</th>
                    <th>产品名称 / Product</th>
                    <th>图片展示 / Image</th>
                    <th>玩具品牌 / Brand</th>
                    <th>规格/尺寸 / Size</th>
                    <th>单位 / Unit</th>
                    <th>数量 / Qty</th>
                    <th>
                      {currency === "USD"
                        ? "美元单价 / USD Unit Price"
                        : "人民币单价 / CNY Unit Price"}
                    </th>
                    <th>
                      {currency === "USD"
                        ? "美元报价 / USD Amount"
                        : "人民币报价 / CNY Amount"}
                    </th>
                    <th>色卡编号 / Colour</th>
                    <th>体积 / Volume</th>
                    <th>备注 / Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {quoteGroups.flatMap(([area, items]) => [
                    <tr className="areaRow" key={`${area}-area`}>
                      <td colSpan={13}>{area}</td>
                    </tr>,
                    ...items.map((p) => {
                      const unitPrice = displayPrice(p);
                      const amount =
                        unitPrice === null ? null : unitPrice * p.qty;
                      const serial = cartItems.indexOf(p) + 1;
                      return (
                        <tr key={p.id}>
                          <td>{serial}</td>
                          <td>{p.sku || "—"}</td>
                          <td>
                            <b>{p.name}</b>
                            {p.en && <small>{p.en}</small>}
                          </td>
                          <td>
                            <div className="quoteImage">
                              <Visual p={p} mini />
                            </div>
                          </td>
                          <td>{p.brand || "YIFUN"}</td>
                          <td>{p.spec || "—"}</td>
                          <td>{p.unit || "—"}</td>
                          <td>{p.qty}</td>
                          <td>{money(unitPrice, currency)}</td>
                          <td>{money(amount, currency)}</td>
                          <td>{p.colorTag === "未识别" ? "—" : p.colorTag}</td>
                          <td>{p.volume || "—"}</td>
                          <td>{p.note || "—"}</td>
                        </tr>
                      );
                    }),
                  ])}
                </tbody>
                <tfoot>
                  <tr className="costRow">
                    <td colSpan={10}>
                      包装费（含部分产品特定包装箱） / Packaging fee (including
                      special packing cases)
                    </td>
                    <td colSpan={3}>
                      <input
                        type="number"
                        value={fees.packaging}
                        onChange={(e) =>
                          setFees({
                            ...fees,
                            packaging: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                  </tr>
                  <tr className="costRow">
                    <td colSpan={10}>除甲醛 / Formaldehyde removal</td>
                    <td colSpan={3}>
                      <input
                        type="number"
                        value={fees.formaldehyde}
                        onChange={(e) =>
                          setFees({
                            ...fees,
                            formaldehyde: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                  </tr>
                  <tr className="costRow">
                    <td colSpan={10}>
                      运输费（含装货不含卸货） / Shipping fee (loading included,
                      unloading excluded)
                    </td>
                    <td colSpan={3}>
                      <input
                        type="number"
                        value={fees.shipping}
                        onChange={(e) =>
                          setFees({
                            ...fees,
                            shipping: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                  </tr>
                  <tr className="costRow">
                    <td colSpan={10}>
                      安装费 / Installation fee{" "}
                      <select
                        value={
                          installationIncludesTravel ? "included" : "excluded"
                        }
                        onChange={(e) =>
                          setInstallationIncludesTravel(
                            e.target.value === "included",
                          )
                        }
                      >
                        <option value="included">
                          含工人出行食宿 / Travel & accommodation included
                        </option>
                        <option value="excluded">
                          不含工人出行食宿 / Travel & accommodation excluded
                        </option>
                      </select>
                    </td>
                    <td colSpan={3}>
                      <input
                        type="number"
                        value={fees.installation}
                        onChange={(e) =>
                          setFees({
                            ...fees,
                            installation: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={10}>
                      小计（不含税） / Subtotal (tax excluded)
                    </td>
                    <td>{money(preTax, currency)}</td>
                    <td colSpan={2}>
                      产品与附加费用合计 / Products and additional fees
                    </td>
                  </tr>
                  {currency === "CNY" && (
                    <tr>
                      <td colSpan={10}>
                        税额 13%（可抵税） / Tax 13% (deductible)
                      </td>
                      <td>{money(tax, currency)}</td>
                      <td colSpan={2}>
                        按不含税小计计算 / Calculated on pre-tax subtotal
                      </td>
                    </tr>
                  )}
                  {showDesignDeduction ? (
                    <tr className="costRow">
                      <td colSpan={10}>
                        设计费抵扣 / Design fee deduction{" "}
                        <button
                          className="hideDeduction"
                          onClick={() => setShowDesignDeduction(false)}
                        >
                          隐藏 / Hide
                        </button>
                      </td>
                      <td colSpan={3}>
                        <input
                          type="number"
                          value={fees.designDeduction}
                          onChange={(e) =>
                            setFees({
                              ...fees,
                              designDeduction: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr className="showDeduction">
                      <td colSpan={13}>
                        <button onClick={() => setShowDesignDeduction(true)}>
                          ＋ 显示设计费抵扣 / Show design fee deduction
                        </button>
                      </td>
                    </tr>
                  )}
                  <tr className="grandTotal">
                    <td colSpan={10}>
                      {currency === "CNY"
                        ? "总计（含税） / Total (tax included)"
                        : "总计 / Total"}
                    </td>
                    <td>{money(totalWithTax, currency)}</td>
                    <td colSpan={2}>
                      {currency === "CNY"
                        ? "已含税并扣除设计费 / Tax included, design deduction applied"
                        : "Design deduction applied"}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <footer className="quoteFooter">
                <b>上海亦玩游乐设备集团有限公司 / Yifun Life Group</b>
                <p>Infinite Idea, Endless Joy.</p>
                <span>YIFUN LIFE</span>
              </footer>
              <div className="pdfFooter">
                <span>
                  {companyAddress ||
                    "公司地址待填写 / Company address to be confirmed"}
                </span>
                <span>
                  第 <i /> 页 / Page <i />
                </span>
              </div>
            </article>
          </div>
        </div>
      )}
    </main>
  );
}
