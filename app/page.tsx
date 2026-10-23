"use client";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import PasswordField from "./password-field";
import * as XLSX from "xlsx";
import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from "fflate";
import { costingInputFromRow, type QuoteCosting } from "../lib/costing-import";
import { usdFromCny } from "../lib/currency";
import { applyQuoteRevisions, excludedFromQuote, revisionLabels, type QuoteRevision } from "../lib/quote-revisions";
import { quotationTotals } from "../lib/quotation";
import { embedQuoteImages, prepareQuoteTemplateImages } from "../lib/quote-excel-images";
import type { CatalogProduct } from "./catalog-types";
import { pairedArea, pairedAreasForMajor } from "../lib/area-pairing";
type MajorCategory =
  | "职业体验 / Career Experience"
  | "生活场景 / Lifestyle Scene"
  | "零售（游玩必备） / Retail"
  | "农牧生活 / Agro-pastoral Life"
  | "动物世界 / Animal World"
  | "车生活 / Car Life"
  | "拼装手工 / Assemble by Hand"
  | "机械传动 / Playground Scenes"
  | "多媒体互动 / Multimedia Interactivity"
  | "大童类 / Older Children";
type NavigationMajor = MajorCategory | "农牧生活 / 动物世界";
type NavigationGroup = "all" | "simulation" | "toys";
type Override = {
  productId: string;
  name?: string | null;
  price?: string | null;
  imageUrl?: string | null;
  volume?: string | null;
  specification?: string | null;
  unit?: string | null;
  cost?: number | null;
  branchPrice?: number | null;
  supplyMethod?: string | null;
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
type ProductClassification = {
  id: string;
  productId: string;
  level1: string;
  level2: string;
  level3: string;
};
type ProductTag = { productId: string; tag: string };
type Product = CatalogProduct & {
  revision?: QuoteRevision;
  quoteCosting?: QuoteCosting;
  volume: string;
  cost: number | null;
  branchPrice: number | null;
  supplyMethod: string | null;
  stock: number | null;
  majorCategory: MajorCategory;
  category1: string;
  category2: string;
  category3: string;
  classifications: ProductClassification[];
  tags: string[];
  viewKey?: string;
  colorTag: string;
  hasScreen: boolean;
  isRecommended: boolean;
  relatedIds: string[];
  catalogProductId?: string;
  importArea?: string;
  importSourceRow?: number;
  importBlueColumns?: number[];
  importSequence?: string;
  importSourceQuantity?: number | null;
  importSection?: number;
};

const quotationProductOrder = (product: Product) => {
  if (!product.sku.trim()) return 0;
  const productType = product.tags.find((tag) =>
    ["主设备", "配套产品", "配套玩具", "广告类型", "地面/地胶"].includes(tag),
  ) || product.category3;
  if (productType === "配套产品") return 2;
  if (productType === "配套玩具") return 3;
  if (productType === "广告类型") return 4;
  if (productType === "地面/地胶") return 5;
  return 1;
};

const compareQuotationItems = (
  left: { product: Product },
  right: { product: Product },
) => {
  const leftSourceRow = left.product.importSourceRow;
  const rightSourceRow = right.product.importSourceRow;
  if (leftSourceRow !== undefined && rightSourceRow !== undefined) {
    return leftSourceRow - rightSourceRow;
  }
  const priority = quotationProductOrder(left.product) - quotationProductOrder(right.product);
  if (priority) return priority;
  return left.product.sku.localeCompare(right.product.sku);
};
const isToy = (product: Product) =>
  product.tags.includes("配套玩具") || product.category3 === "配套玩具";
const isAccessoryProductName = (name: string) =>
  /凳|椅|衣架|挂钩|购物车|购物篮/.test(name);
const isPairedItem = (product: Product) =>
  product.tags.includes("配套产品") || product.category3 === "配套产品" || isToy(product);
const isFutureArea = (area: string) => area.includes("未来");
const pairingBaseArea = (area: string) => area.replace("（英文版）", "");
const groupedNavigationArea = (area: string, navigationGroup?: NavigationGroup) => {
  const baseArea = pairingBaseArea(area);
  if (baseArea === "厨房区" || baseArea === "未来厨房区") return "厨房区";
  if (baseArea === "超市区" || baseArea === "未来超市区") return "超市区";
  if (
    navigationGroup === "toys" &&
    ["种植区", "果蔬区", "未来果蔬区", "未来种植区"].includes(baseArea)
  ) return "种植区";
  return area;
};
const retailTypeDisplayName = (type: string) =>
  type === "(定制LOGO+0.27/双/定码定色/单码单色1000起，250双清箱)"
    ? "防滑袜"
    : type;
const groupedAreaDisplayPriority = (
  area: string,
  selectedArea: string,
  navigationGroup: NavigationGroup,
) => {
  if (groupedNavigationArea(area, navigationGroup) !== selectedArea) return 2;
  return isFutureArea(pairingBaseArea(area)) ? 0 : 1;
};
type ProductRelation = {
  productId: string;
  relatedProductId: string;
  quantity?: number;
};
type PairingSuggestion = {
  source: Product;
  mode: "catalog" | "cart";
  relatedItems: Array<{
    product: Product;
    quantity: number;
    isBound: boolean;
  }>;
};
type PairingRemovalPrompt = {
  device: Product;
  relatedItems: Array<{ product: Product; quantity: number }>;
};
type QuoteImportPreview = {
  fees?: QuoteHistorySnapshot["fees"];
  includeTax?: boolean;
  fileName: string;
  rows: Array<{ product: Product; quantity: number }>;
  matched: Array<{ product: Product; quantity: number }>;
  imported: Array<{ product: Product; quantity: number }>;
  unmatchedSkus: string[];
  sourceRows: number;
  projectName: string;
  designerName: string;
  salesName: string;
};
type QuoteImportPriceMode = "factory" | "vip" | "usd";
const importedQuoteHeaders = [
  ["序号", "No."], ["款号", "Item Number"], ["产品名称", "Product Name"],
  ["图片展示", "Product Name"], ["玩具品牌", "Toy Brands"],
  ["规格/尺寸", "Specifications /Dimensions"], ["单位", "Unit"], ["数量", "Quantity"],
  ["成本单价", "RMB"], ["成本价", "RMB"], ["单价", "RMB"], ["合计金额", "RMB"],
  ["美元单价", "Unit Price (USD)"], ["美元合计total", "(USD)"],
  ["区域小计", "Subtotal (USD)"], ["备注", "Notes", "客户知晓"],
  ["材质/工艺做法", "Materials / Workmanship", "仅内部知晓 / Internal Use Only"], ["体积", "Volume"],
];
type PriceMode = QuoteImportPriceMode;
type QuoteImportColumns = {
  sequence: number;
  sku: number;
  name: number;
  image: number;
  brand: number;
  specification: number;
  unit: number;
  quantity: number;
  cnyUnit: number;
  cnyAmount: number;
  usdUnit: number;
  usdAmount: number;
  areaSubtotal: number;
  color: number;
  note: number;
  volume: number;
  material?: number;
};
type QuoteImportTemplate = {
  headers?: string[][];
  title?: string;
  footerNotes?: string[];
  feeNotes?: Partial<Record<"packaging" | "formaldehyde" | "shipping" | "installation" | "subtotal" | "tax" | "total", string>>;
  feeLabels?: Partial<Record<"packaging" | "formaldehyde" | "shipping" | "installation" | "subtotal" | "tax" | "total", string>>;
  source?: ArrayBuffer;
  id?: string;
  fileName: string;
  headerRow: number;
  columns: QuoteImportColumns;
  insertBeforeRow?: number;
  totalRow?: number;
  feeRows?: Partial<Record<"packaging" | "formaldehyde" | "shipping" | "installation" | "designDeduction" | "subtotal" | "tax", number>>;
  metadata: {
    designer?: { row: number; column: number };
    sales?: { row: number; column: number };
  };
};
type AuthMode = "login" | "register" | "forgot" | "reset";
type AuthAccount = {
  email: string;
  name: string;
  role: string;
  expiresAt: string;
};
type QuotationHistoryRecord = {
  id: string;
  contractNo: string;
  projectName: string;
  createdBy?: string;
  generatedAt: string;
  lineageId?: string | null;
  voidedAt?: string | null;
  finalAmount?: number | null;
  finalCurrency?: string | null;
  hasSnapshot?: boolean;
  snapshot?: QuoteHistorySnapshot | null;
};
type QuoteHistoryMode = "new" | "view" | "edit" | "export";
type HistoryExportFormat = "pdf" | "excel";
type QuoteHistorySnapshot = {
  version: 1;
  workspaceProjectId?: string;
  importTemplate?: Omit<QuoteImportTemplate, "source">;
  products: Product[];
  cart: Record<string, number>;
  cartPairings: Record<string, Record<string, number>>;
  importedProducts: Product[];
  importedAreaOrder: string[];
  priceMode: PriceMode;
  projectName: string;
  contractNo: string;
  designerName: string;
  salesName: string;
  companyAddress: string;
  installationIncludesTravel: boolean;
  includeTax: boolean;
  showDesignDeduction: boolean;
  fees: {
    packaging: number;
    formaldehyde: number;
    shipping: number;
    installation: number;
    designDeduction: number;
  };
};
type ToyMatchingDraftSnapshot = Pick<
  QuoteHistorySnapshot,
  | "importTemplate"
  | "fees"
  | "includeTax"
  | "showDesignDeduction"
  | "companyAddress"
  | "installationIncludesTravel"
  | "cart"
  | "cartPairings"
  | "importedProducts"
  | "importedAreaOrder"
  | "priceMode"
  | "workspaceProjectId"
  | "projectName"
  | "contractNo"
  | "designerName"
  | "salesName"
> & { version: 1; importedListName?: string };
type ToyMatchingDraft = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  snapshot?: ToyMatchingDraftSnapshot;
};
const activeQuotationKey = (email: string) => `yifun-active-quotation-v2:${email.toLowerCase()}`;
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
  "零售（游玩必备） / Retail",
  "农牧生活 / Agro-pastoral Life",
  "动物世界 / Animal World",
  "车生活 / Car Life",
  "拼装手工 / Assemble by Hand",
  "机械传动 / Playground Scenes",
  "多媒体互动 / Multimedia Interactivity",
  "大童类 / Older Children",
];
const navigationMajors: NavigationMajor[] = [
  "职业体验 / Career Experience",
  "生活场景 / Lifestyle Scene",
  "农牧生活 / 动物世界",
  "车生活 / Car Life",
  "拼装手工 / Assemble by Hand",
  "机械传动 / Playground Scenes",
  "多媒体互动 / Multimedia Interactivity",
  "大童类 / Older Children",
  "零售（游玩必备） / Retail",
];
const unpairedNavigationMajors = new Set<NavigationMajor>([
  "机械传动 / Playground Scenes",
  "多媒体互动 / Multimedia Interactivity",
  "零售（游玩必备） / Retail",
]);
const majorCategoryDisplayName = (major: string) =>
  major === "多媒体互动 / Multimedia Interactivity"
    ? "数字运动类 / Digital Sports"
    : major;
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
    "零售（游玩必备） / Retail",
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
  恐龙区域配套玩具: "动物世界 / Animal World",
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
const colorOptions = ["红", "粉", "黄", "蓝", "黑", "白", "银色", "橙", "绿", "紫"];
const colorSwatches: Record<string, string> = {
  红: "#d83d48", 粉: "#ef9a9a", 黄: "#ddbd26", 蓝: "#2f7eb9",
  黑: "#1c242d", 白: "#ffffff", 银色: "#b9bec4", 橙: "#e9812f", 绿: "#3f9862", 紫: "#8756b6",
};
const baseColorByLegacyTag: Record<string, string> = {
  浅红: "粉", 深红: "红",
  浅橙: "橙", 深橙: "橙",
  浅黄: "黄", 深黄: "黄",
  浅绿: "绿", 深绿: "绿",
  浅青: "蓝", 青: "蓝", 深青: "蓝",
  浅蓝: "蓝", 深蓝: "蓝",
  浅紫: "紫", 深紫: "紫",
};
const normalizeColorTag = (colorTag: string) => baseColorByLegacyTag[colorTag] || colorTag;
const colorEnglish: Record<string, string> = {
  红: "Red", 粉: "Pink", 黄: "Yellow", 蓝: "Blue", 黑: "Black", 白: "White", 银色: "Silver",
  橙: "Orange", 绿: "Green", 紫: "Purple",
  无主图: "No main image", 待重新识别: "Pending colour scan", 未识别: "Colour not identified", 不适用: "N/A",
};
const colourLabel = (colorTag: string) => ({
  zh: colorTag || "—",
  en: colorEnglish[colorTag] || (colorTag ? "Colour" : "—"),
});
const unitEnglish: Record<string, string> = {
  套: "Set", 件: "Piece", 个: "Piece", 只: "Piece", 张: "Piece", 台: "Unit", 组: "Set",
  对: "Pair", 箱: "Carton", 把: "Piece", 片: "Piece", 米: "m", 平方米: "m²",
};
const unitLabel = (unit: string) => {
  if (!/[\u4e00-\u9fff]/.test(unit)) return {zh: unit || "—", en: ""};
  const {zh, en} = splitBilingual(unit);
  return {zh: zh || "—", en: en || unitEnglish[unit] || (unit ? "Unit" : "—")};
};
const isSpaceTheme = (name: string, en: string) => /太空|space/i.test(`${name} ${en}`);
const screenWords = /屏|screen|投影|多媒体|互动|vr|电视|监视/i;
const money = (value: number | null, currency: "CNY" | "USD", decimals = currency === "CNY" ? 0 : 2) => {
  if (value === null) return "待确认";
  const amount = new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return currency === "CNY" ? `CNY ¥${amount}` : `USD $${amount}`;
};
// Generated from the supplied Chinese product names.
const englishNameByProductId: Record<string, string> = {
  "toys-Y31259": "Cutting board and cuttable food set",
  "toys-Y40154": "Milk (Flannelette Version)",
  "toys-Y40149-E": "Organic rice",
  "toys-Y40150-E": "Whole wheat flour",
  "toys-Y40151-E": "Dongbei rice",
  "toys-Y40152-E": "Buckwheat flour",
  "toys-Y40153-E": "Rainbow sugar（Flannelette Version）",
  "toys-Y40154-E": "Milk (Flannelette Version)",
  "toys-Y40155-E": "Chip Versions (Flannelette Version)",
  "toys-Y40156-E": "Chocolate (Flannelette Version)",
  "toys-Y40157-E": "Potato Chip Versions (Flannelette Version)",
  "toys-Y40158-E": "Egg yolk cake (Flannelette Version)",
  "toys-Y40159-E": "Milk candy (Flannelette Version)",
  "toys-Y40160-E": "Strawberry gummy (Flannelette Version)",
  "toys-Y40161-E": "Sandwich biscuits (Flannelette Version)",
  "toys-Y40162-E": "Potato Chip Versions (Flannelette Version)",
  "toys-Y40163-E": "Potato Chip Versions (Flannelette Version)",
  "toys-Y40164-E": "Dried apple (Flannelette Version)",
  "toys-Y40571-E": "Rainbow sugar（Leather Version）",
  "toys-Y40572-E": "Milk (Leather Version)",
  "toys-Y40573-E": "Chip Versions（Leather Version）",
  "toys-Y40574-E": "Chocolate (Leather Version)",
  "toys-Y40575-E": "Potato Chip Versions（Leather Version）",
  "toys-Y40576-E": "Egg yolk cake (Leather Version)",
  "toys-Y40578-E": "Strawberry gummy（Leather Version）",
  "toys-Y40579-E": "Sandwich biscuits (Leather Version)",
  "toys-Y40581-E": "Potato Chip Versions（Leather Version）",
  "toys-Y40582-E": "Potato Chip Versions（Leather Version）",
  "toys-Y40580-E": "Dried apple（Leather Version）",
  "toys-Y40486-E": "Chip Versions（A set of four）",
  "toys-Y40487-E": "Beverage（A set of four）",
  "toys-Y40488-E": "Beverage（A set of six）",
  "toys-Y40495-E": "Bagged coffee beans (chocolate flavor)",
  "toys-Y40496-E": "Bagged coffee beans (Italian style)",
  "toys-Y40497-E": "Milk",
  "toys-Y40542-E": "Milk (A set of six)",
  "toys-Y40583-E": "Milk (A set of six)",
  "toys-Y40235": "Pink Pork Chops",
  "toys-Y40268": "Original radish (chip version)",
  "toys-Y40455-E": "Whole wheat flour",
  "toys-Y40456-E": "Buckwheat flour",
  "toys-Y40457-E": "Cake flour",
  "toys-Y40458-E": "Rainbow sugar",
  "toys-Y40459-E": "Milk",
  "toys-Y40460-E": "Chip Versions",
  "toys-Y40461-E": "Chocolate",
  "toys-Y40462-E": "Potato Chip Versions",
  "toys-Y40463-E": "Egg yolk cake",
  "toys-Y40464-E": "Milk candy",
  "toys-Y40465-E": "Strawberry gummy",
  "toys-Y40466-E": "Sandwich biscuits",
  "toys-Y40467-E": "Potato Chip Versions",
  "toys-Y40468-E": "Potato Chip Versions",
  "toys-Y40469-E": "Dried apple",
  "toys-Y40526-E": "Chip Versions（A set of four）",
  "toys-Y40527-E": "Beverage（A set of four）",
  "toys-Y40528-E": "Beverage（A set of six）",
  "toys-Y40529-E": "Bagged coffee beans (chocolate flavor)",
  "toys-Y40530-E": "Bagged coffee beans (Italian style)",
  "toys-Y40531-E": "Milk",
  "toys-Y40549-E": "Milk (A set of six)",
  "toys-Y31280": "solid brick color",
  "toys-Y31281": "solid brick gray",
  "toys-Y40182-E": "Happy Granules",
  "toys-Y40183-E": "Block Turn Back Pill",
  "toys-Y40184-E": "Contract Tablet",
  "toys-Y40185-E": "Dream Capsule",
  "toys-Y40186-E": "Grow Up Injection",
  "toys-Y40187-E": "Memory Wipes Capsule",
  "toys-Y40229-E": "Happy Granules",
  "toys-Y40489-E": "Cute Tablet",
  "toys-Y40490-E": "Energy Liquid",
  "toys-Y40491-E": "Power Capsule",
  "toys-Y40492-E": "Health Granules",
  "toys-Y40493-E": "Brave Capsule",
  "toys-Y40494-E": "Fast Swimming Pill",
  "toys-Y40210-E": "Happy Granules",
  "toys-Y40211-E": "Block Turn Back Pill",
  "toys-Y40212-E": "Contract Tablet",
  "toys-Y40213-E": "Dream Capsule",
  "toys-Y40214-E": "Grow Up Injection",
  "toys-Y40215-E": "Memory Wipes Capsule",
  "toys-Y40556-E": "Happy Granules",
  "toys-Y40557-E": "Cute Tablet",
  "toys-Y40558-E": "Energy Liquid",
  "toys-Y40559-E": "Power Capsule",
  "toys-Y40560-E": "Health Granules",
  "toys-Y40561-E": "Brave Capsule",
  "toys-Y40562-E": "Fast Swimming Pill",
  "toys-Y40614-E": "Stable Granules-Screen-Display CT Machine (Woven Fabric Model)",
  "toys-Y40616-E": "Anshen Bunaojie-Screen Display CT Machine (Roh cloth Model)",
  "toys-Y40618-E": "Placebo-Display CT Machine (Cotton Fabric Model)",
  "toys-Y40620-E": "Bulingbuling Agent-Screen-Display CT Machine (Fleece Version)",
  "toys-Y40622-E": "Ultra-clean bubble agent-Screen display CT scanner (velvet fabric version)",
  "toys-Y40624-E": "Jingsi Solution-Screen-Display CT Machine (Velvet Fabric Model)",
  "toys-Y40626-E": "Happy Spit Solution-Display CT Machine (Woven Fabric Model)",
  "toys-Y40628-E": "Dietary Balance Capsule-Screen-Display CT Machine (Woven Fabric Model)",
  "toys-Y40630-E": "Appetite Promoter-Flat-Panel CT Machine (Cotton Fabric Model)",
  "toys-Y40632-E": "Vegetable Supplement-Display CT Machine (Cotton Fabric Model)",
  "toys-Y40636-E": "Empathy Enhancer-Screen-Display CT Machine (Cotton Fabric Version)",
  "toys-Y40634-E": "Sile Lozenges-Screen-Display CT Machine (Woven Fabric Version)",
  "toys-Y40638-E": "Trace Element Particle Screen-Display CT Machine (Woven Fabric Model)",
  "toys-Y40640-E": "Enzyme Digestion Granules-Screen-Display CT Machine (Rongbu Model)",
  "toys-Y40642-E": "One Effective Device-Screen-Display CT Machine (Cotton Fabric Version)",
  "toys-Y40650-E": "Mindfulness Enhancer-Screen-Display CT Machine (Cotton Fabric Version)",
  "toys-Y40644-E": "Probiotic preparation-Display CT scanner (Rongbu model)",
  "toys-Y40646-E": "Energy Boost Agent-Screen-Display CT Machine (Cotton Fabric Version)",
  "toys-Y40648-E": "Clean and modern capsule-screen CT scanner (velvet fabric version)",
  "toys-Y40673-E": "Xueshou Xingxing Pills (Roh fabric version)",
  "toys-Y40615-E": "Stability Granules - Display CT Machine (Leather) Stability Granules - Display CT Machine (Leather)",
  "toys-Y40617-E": "Brain Tonic Display CT Machine (Leather)",
  "toys-Y40619-E": "Placebo Display CT Machine (Leather)",
  "toys-Y40621-E": "Bling Bling Agent - CT Machine with Display (Leather)",
  "toys-Y40623-E": "Ultra Clean Bubble Agent - CT Machine with Display (Leather)",
  "toys-Y40625-E": "Quiet Thinking Solution - CT Machine with Display (Leather)",
  "toys-Y40629-E": "Balanced Diet Capsule - CT Machine with Display (Leather)",
  "toys-Y40631-E": "Appetite Enhancer - Display CT Machine (Leather)",
  "toys-Y40633-E": "Vegetable Supplement - Display CT Machine (Leather)",
  "toys-Y40635-E": "Sile Lozenge - Display CT Machine (Leather)",
  "toys-Y40637-E": "Empathy Enhancer - Display CT Machine (Leather)",
  "toys-Y40639-E": "Trace Element Granules - Display CT Machine (Leather)",
  "toys-Y40641-E": "Digestive Enzyme Granules - Display CT Machine (Leather)",
  "toys-Y40643-E": "One-Dose Effective Pill - Display CT Machine (Leather)",
  "toys-Y40645-E": "Probiotic Supplement - Display CT Machine (Leather)",
  "toys-Y40647-E": "Energy Booster Display CT Machine (Leather) Energy Booster-Screen Display CT Machine (Leather)",
  "toys-Y40649-E": "Clean Renewal Capsule Display CT Machine (Leather)",
  "toys-Y40651-E": "Mindfulness Enhancer - Display CT Machine (Leather) Mindfulness Enhancer - Display CT Machine (Leather)",
  "toys-Y40685-E": "Xueshou Xingxing Pills (Leather)",
  "toys-Y40670-E": "purified water",
  "toys-Y40671-E": "Qudu Beverage",
  "toys-Y40672-E": "Moisturizer (Flannelette)",
  "toys-Y40652-E": "Small Pills - 4 Pieces (Compatible with Display CT Machine)",
  "toys-Y40612-E": "X-Ray Films - 12 Pieces (Compatible with Display CT Machine)",
  "toys-Y40613-E": "Prescriptions - 12 Pieces (Compatible with Display CT Machine)",
  "toys-Y40716-E": "Sedative Granules (Fabric)",
  "toys-Y40717-E": "Tranquilizing&Brain Tonic（Fabric）",
  "toys-Y40718-E": "Placebo(Fabric)",
  "toys-Y40719-E": "Shimmer Elixir (Fabric)",
  "toys-Y40720-E": "Ultra-Pure Foaming Agent (Fabric)",
  "toys-Y40721-E": "Serenity Solution (Fabric)",
  "toys-Y40722-E": "Happy Deto* Syrup（Fabric）",
  "toys-Y40723-E": "Gut Balance Capsules (Fabric)",
  "toys-Y40724-E": "Appetite Enhancer（Fabric）",
  "toys-Y40725-E": "Vegetable Supplement（Fabric）",
  "toys-Y40726-E": "Empathy Booster(Fabric)",
  "toys-Y40727-E": "Mindjoy Tablets（Fabric）",
  "toys-Y40728-E": "Trace Elements Granules (Fabric)",
  "toys-Y40729-E": "Digestive Enzyme Granules (Fabric)",
  "toys-Y40730-E": "Instant Relief Pill (Fabric)",
  "toys-Y40731-E": "Mindfulness Booster (Fabric)",
  "toys-Y40732-E": "Probiotic Formula (Fabric)",
  "toys-Y40733-E": "Vitality Booster (Fabric)",
  "toys-Y40734-E": "Clean Slate Capsules (Fabric)",
  "toys-Y40735-E": "Rapid Awakening Pill (Fabric)",
  "toys-Y40736-E": "Purified Water（Fabric）",
  "toys-Y40737-E": "Funjoy Beverage（Fabric）",
  "toys-Y40738-E": "Body Lotion（Fabric）",
  "toys-Y40739-E": "Pill-4 pieces (Fabric)",
  "toys-Y40740-E": "Prescription form(12 pieces)",
  "toys-Y40188-E": "Kitty Hair-Removal",
  "toys-Y40189-E": "Kitty Sticky Pill",
  "toys-Y40190-E": "Puppy Joy Pill",
  "toys-Y40191-E": "Puppy Energy Pill",
  "toys-Y40192-E": "Bagged cat litter",
  "toys-Y40220-E": "Natural tofu cat litter",
  "toys-Y40193-E": "Bagged cat food",
  "toys-Y40221-E": "Pet snacks",
  "toys-Y40222-E": "Pet snacks",
  "toys-Y40223-E": "Bagged dog food",
  "toys-Y40224-E": "Bagged dog food",
  "toys-Y40225-E": "Pet snacks (A set of three)",
  "toys-Y40216-E": "Kitty Hair-Removal Breast Hair Remover (Leather)",
  "toys-Y40217-E": "Kitty Sticky Pill",
  "toys-Y40218-E": "Puppy Joy Pill",
  "toys-Y40219-E": "Puppy Energy Pill Puppy Energy Pill (Leather)",
  "toys-Y40563-E": "Bagged cat litter",
  "toys-Y40564-E": "Natural tofu cat litter",
  "toys-Y40565-E": "Bagged cat food",
  "toys-Y40566-E": "Pet snacks",
  "toys-Y40567-E": "Pet snacks",
  "toys-Y40568-E": "Bagged dog food",
  "toys-Y40569-E": "Bagged dog food",
  "toys-Y40570-E": "Pet snacks (A set of three)",
  "toys-Y40226-E": "Pet snacks",
  "toys-Y40227-E": "Canned cat food (A set of four)",
  "toys-Y40228-E": "Canned pet food (A set of four)",
  "toys-Y40675": "Bucket (random color) Bucket (random color)",
  "junior-Y10178": "island kitchen",
  "junior-Y10179": "kitchen table",
  "junior-Y10180": "stool",
  "junior-Y10181": "hook up",
  "junior-Y10100": "Nordic kitchen combination (complete set)",
  "junior-Y10113": "British kitchen set (complete set)",
  "junior-Y10117": "Korean style kitchen cabinet combination (complete set)",
  "junior-Y10132": "Rainbow kitchen set (complete set)",
  "junior-Y10122": "Space kitchen combination (complete set)",
  "junior-Y10131": "Space round console (complete set)",
  "junior-Y10153": "space bread style",
  "junior-Y10156": "console",
  "junior-Y10157": "locker",
  "junior-Y10158": "cabinet hanging cabinet",
  "junior-Y10159": "Bakery cabinet",
  "junior-Y10160": "Planet range hood",
  "junior-Y10146": "bubble cloud wind",
  "junior-Y10147": "Round cabinet combination",
  "junior-Y10149": "kitchen clouds background",
  "junior-Y10148": "Oval refrigerator",
  "junior-Y10150": "Kitchen door sign",
  "junior-Y10139": "Classic tricolor style",
  "junior-Y10142": "refrigerator",
  "junior-Y10143": "Low cabinet",
  "junior-Y10144": "small oven",
  "junior-Y10141": "console",
  "junior-Y10140": "range hood",
  "junior-Y10151": "dining stool",
  "junior-Y10152": "dining table",
  "junior-Y10155": "sink",
  "junior-Y10171": "kitchen dining table and chairs",
  "junior-Y10172": "kitchen island",
  "junior-Y10173": "kitchen storage cabinets",
  "junior-Y10175": "little chef",
  "junior-Y10176": "Mini little chef",
  "junior-Y10184": "wardrobe",
  "junior-Y10185": "Trolley food area",
  "junior-Y10186": "cake making table",
  "junior-Y10177": "Kitchen (with monitor)",
  "junior-Y10169": "future kitchen",
  "junior-Y10174": "future kitchen",
  "junior-Y10170": "future kitchen",
  "junior-Y10182": "dubai mosque kitchen",
  "junior-Y10183": "indian mosque kitchen",
  "junior-Y10352": "Checkout touch screen with voice (dual sensor version)",
  "junior-Y10336": "The cashier of the future",
  "junior-Y10347": "The cashier of the future",
  "junior-Y10358": "Vertical screen dual sensor cashier",
  "junior-Y10361": "Vertical screen single sensor cashier",
  "junior-Y10350": "container",
  "junior-Y10356": "container",
  "junior-Y10357": "Grid shelf A",
  "junior-Y10359": "Grid shelf B",
  "junior-Y10360": "Oblique triangle shelves",
  "junior-Y10362": "Pastoral Grocery Rack A",
  "junior-Y10363": "Pastoral Grocery Rack B",
  "junior-Y10364": "Trolley shelves",
  "junior-Y10365": "Plant style shelves",
  "junior-Y10366": "Dome shelves",
  "junior-Y10367": "Spring shelves",
  "junior-Y10368": "Ferris wheel shelves",
  "junior-Y10369": "Peaked shelves",
  "junior-Y10370": "Bread shelf",
  "junior-Y10371": "Cake shelves",
  "junior-Y10372": "Metal double layer shelves",
  "junior-Y10373": "Arc top shelves",
  "junior-Y10351": "Fresh food cabinet",
  "junior-Y10355": "Fresh food shelves",
  "junior-Y10353": "Styling rack",
  "junior-Y10354": "Covered container",
  "junior-Y10301": "Light luxury front desk",
  "junior-Y10302": "Light luxury front desk",
  "junior-Y10303": "Light luxury front desk",
  "junior-Y10304": "Desktop three-column shelves",
  "junior-Y10305": "Desktop two-column shelves",
  "junior-Y10306": "Vertical double row",
  "junior-Y10307": "Desktop Freezer",
  "junior-Y10308": "Three floors surrounding the central island",
  "junior-Y10309": "European style operating table",
  "junior-Y10310": "rainbow shelves",
  "junior-Y10311": "rainbow cashier",
  "junior-Y10313": "Space display stand",
  "junior-Y10315": "Square top metal shelves",
  "junior-Y10316": "Dome metal shelves",
  "junior-Y10317": "Fruit and vegetable island",
  "junior-Y10320": "Flat top cash register",
  "junior-Y10322": "Korean cashier",
  "junior-Y10323": "Black and white pattern cashier",
  "junior-Y10325": "half top shelf",
  "junior-Y10326": "full top shelf",
  "junior-Y10328": "Styling shelves",
  "junior-Y10330": "Classic dessert cart",
  "junior-Y10331": "Double-layer three-compartment shelf",
  "junior-Y10332": "shelves",
  "junior-Y10334": "Space double-layer island",
  "junior-Y10335": "checkout counter",
  "junior-Y10337": "Double-layer 4-compartment shelf",
  "junior-Y10338": "Wall container",
  "junior-Y10339": "supermarket arc",
  "junior-Y10342": "Supermarket island",
  "junior-Y10341": "float",
  "junior-Y10343": "float decoration",
  "junior-Y10344": "float stand",
  "junior-Y10345": "float brand",
  "junior-Y10346": "forest container",
  "junior-Y10348": "Supermarket double-layer low shelves",
  "junior-Y10349": "round supermarket shelves",
  "junior-Y10454": "Makeup cabinet",
  "junior-Y10455": "AR camera",
  "junior-Y10456": "square jewelry table",
  "junior-Y10457": "Avatar camera (two persons)",
  "junior-Y10458": "Props table",
  "junior-Y10459": "square stool",
  "junior-Y10460": "Square four-legged stool",
  "junior-Y10461": "metal hanger",
  "junior-Y10463": "Avatar camera (single place)",
  "junior-Y10440": "Handmade beads (including decorative beads)",
  "junior-Y10442": "double sided dressing table",
  "junior-Y10446": "fitting room",
  "junior-Y10447": "L shaped wardrobe",
  "junior-Y10448": "Wardrobe",
  "junior-Y10449": "wall makeup mirror",
  "junior-Y10450": "wall cabinet",
  "junior-Y10451": "jewelry cabinet",
  "junior-Y10401": "Single round dressing table",
  "junior-Y10402": "square dressing table",
  "junior-Y10404": "luxury dressing table",
  "junior-Y10405": "Double sided makeup table",
  "junior-Y10407": "Korean style double sided",
  "junior-Y10411": "double sided dressing table",
  "junior-Y10412": "Metal makeup wardrobe",
  "junior-Y10413": "Combination jewelry cabinet",
  "junior-Y10416": "Decoration cabinet",
  "junior-Y10417": "Korean semicircle",
  "junior-Y10421": "Styling full length mirror",
  "junior-Y10423": "Butterfly single sided",
  "junior-Y10426": "Floor-standing simple clothes hanger",
  "junior-Y10427": "Jewelry display cabinet",
  "junior-Y10428": "Jewelry display cabinet",
  "junior-Y10429": "Wardrobe/display cabinet (single layer)",
  "junior-Y10431": "Round mirror makeup table",
  "junior-Y10432": "iNi Pig",
  "junior-Y10433": "Korean style round shape",
  "junior-Y10434": "butterfly double sided",
  "junior-Y10410": "dressing table for three",
  "junior-Y10436": "round dressing table",
  "junior-Y10430": "changing curtain",
  "junior-Y10439": "Changing room",
  "junior-Y10415": "Double dressing table",
  "junior-Y10437": "lipstick stool",
  "junior-Y10443": "bread stool",
  "junior-Y10441": "U-shaped stool",
  "junior-Y10452": "princess makeup chair",
  "junior-Y10581": "container truck",
  "junior-Y10582": "Express truck",
  "junior-Y10583": "motorcycle",
  "junior-Y10585": "raptor",
  "junior-Y10586": "car wash equipment",
  "junior-Y10587": "High foaming car wash liquid",
  "junior-Y10588": "Oil-free silent air compressor",
  "junior-Y10589": "High pressure gas tank",
  "junior-Y10590": "Screw air compressor",
  "junior-Y10571": "car wash pool",
  "junior-Y10572": "Car wash wardrobe",
  "junior-Y10577": "4-seater racing table (including screen)",
  "junior-Y10578": "Pentagram racing screen cabinet",
  "junior-Y10566": "Racing table (with screen)",
  "junior-Y105103": "Four-person racing table card version three-in-one",
  "junior-Y105104": "Four-person racing table card version 2-in-1",
  "junior-Y105105": "Four-seater racing table three-in-one",
  "junior-Y105106": "Four-seater racing table 2-in-1",
  "junior-Y105108": "Self-weighted racing car-track",
  "junior-Y105109": "Deadweight racing car-assembly table (small)",
  "junior-Y105110": "Self-weight racing car-assembly table (large)",
  "junior-Y10568": "podium",
  "junior-Y10569": "racing cabinet",
  "junior-Y10518": "racing track set",
  "junior-Y10597": "Double curved handle racing table",
  "junior-Y10598": "Steering wheel remote racing table",
  "junior-Y10599": "Grid racing cabinet",
  "junior-Y105107": "New excavation table round",
  "junior-Y105100": "New Excavation Table Round - Card Version",
  "junior-Y105101": "New excavation table",
  "junior-Y105102": "New Dig Table Square - Card Version",
  "junior-Y10512": "Robot oil dispenser",
  "junior-Y10513": "retro gas pump",
  "junior-Y10514": "Tesla gas pump",
  "junior-Y10515": "Korean style oil dispenser",
  "junior-Y10520": "vertical charging station",
  "junior-Y10521": "Wall mounted charging station",
  "junior-Y10525": "Yuanyuan oil dispenser",
  "junior-Y10541": "traffic light",
  "junior-Y10528": "racing traffic light",
  "junior-Y11134": "Second generation double video game table and chair",
  "junior-Y11118": "Double video game table and chair",
  "junior-Y11119": "Double video game table and chair",
  "junior-Y11148": "Mechanical style two-handle video game",
  "junior-Y11149": "video game sofa",
  "junior-Y10535": "Mechanic Wall and Cabinet",
  "junior-Y10536": "Tyre Rack",
  "junior-Y10519": "Frame repair generation",
  "junior-Y10575": "Second generation bike frame repair",
  "junior-Y10562": "Repair frame with lift",
  "junior-Y11501": "Dinosaur identification table (wide)",
  "junior-Y11502": "Dinosaur identification table (narrow)",
  "junior-Y11503": "Dinosaur fossil identification machine",
  "junior-Y11504": "dinosaur cabinet",
  "junior-Y11506": "dinosaur eggs",
  "junior-Y11507": "Dinosaur storage rack",
  "junior-Y11508": "Dinosaur storage rack",
  "junior-Y11509": "Dinosaur identification table-card version",
  "junior-Y11510": "Dinosaur slaps the wall",
  "junior-Y116001": "Demining area-storage cabinet",
  "junior-Y116002": "Demining area-operation table",
  "junior-Y116003": "Demining area-box-shaped square stool",
  "junior-Y116004": "Demining area-lookout",
  "junior-Y116005": "Demining area - front desk",
  "junior-Y116006": "Demining area-storage basket",
  "junior-Y116007": "Demining area-award podium",
  "junior-Y116008": "Demining area-medal display cabinet",
  "junior-Y117001": "Aircraft lobby-security desk",
  "junior-Y117002": "Aircraft lobby - conveyor belt",
  "junior-Y117003": "Aircraft lobby-self-service ticket vending machine",
  "junior-Y117004": "Aircraft lobby-aviation information screen",
  "junior-Y117005": "Aircraft lobby-waiting seats",
  "junior-Y117006": "Aircraft lobby-security gate",
  "junior-Y117007": "Aircraft lobby-luggage assembly cabinet",
  "junior-Y117008": "Airplane lobby-luggage rack",
  "junior-Y117009": "Aircraft lobby - guide signs",
  "junior-Y117010": "Aircraft Hall-Tower",
  "junior-Y117011": "Aircraft lobby-large aircraft",
  "junior-Y117012": "Aircraft lobby-cabin seats",
  "junior-Y117013": "arch",
  "junior-Y117014": "trolley",
  "junior-Y10501": "police station",
  "junior-Y10538": "police interrogation room",
  "junior-Y10502": "Police station reception desk",
  "junior-Y10503": "Police station reception desk 2",
  "junior-Y10504": "interrogation room",
  "junior-Y10505": "multifunctional police",
  "junior-Y10526": "police car",
  "junior-Y10529": "police cabinet",
  "junior-Y10553": "Multifunctional police cabinet",
  "junior-Y10554": "police cabinet",
  "junior-Y10555": "flight attendant cabinet",
  "junior-Y10556": "Half-Circle Detective Cabinet",
  "junior-Y10557": "Architect Wardrobe",
  "junior-Y10558": "Architect Hat Cabinet",
  "junior-Y10559": "Children's play cabinet",
  "junior-Y10531": "Construction site conveyor belt",
  "junior-Y10570": "Excavator table",
  "junior-Y10543": "Excavator table",
  "junior-Y10544": "Excavator table",
  "junior-Y10545": "Excavator table",
  "junior-Y10561": "Excavator table 2 persons",
  "junior-Y10591": "Excavator table for 2 people (single screen)",
  "junior-Y10592": "Excavator table 4 people (single screen)",
  "junior-Y10593": "Excavator table for 4 people (no screen)",
  "junior-Y10594": "Excavator table 4 people (dual screen)",
  "junior-Y10595": "Excavator table for 4 people (no screen)",
  "junior-Y10506": "Multifunctional fire protection",
  "junior-Y10552": "fire cabinet",
  "junior-Y10508": "fire truck",
  "junior-Y105112": "Fire-alarm booth",
  "junior-Y105113": "Fire equipment warehouse",
  "junior-Y105114": "Firefighting-Fire field combat platform",
  "junior-Y105115": "fire truck",
  "junior-Y105116": "fire engine",
  "junior-Y105117": "fire truck",
  "junior-Y105118": "Fire-fog escape route",
  "junior-Y105119": "stop sign",
  "junior-Y105121": "Fire water jet",
  "junior-Y105122": "car wash flying saucer",
  "junior-Y10532": "Fire shooting 2 persons",
  "junior-Y10533": "Fire shooting 4 people",
  "junior-Y11370": "Dinosaur World Two-Player Water Blaster",
  "junior-Y11371": "Ironclad Hero 2 Two-Player Water Blaster",
  "junior-Y11372": "Squirting Piggy Two-Player Water Blaster",
  "junior-Y11373": "Dinosaur World - 4-player ball shooting",
  "junior-Y11374": "Dinosaur World [3-player shooting]",
  "junior-Y11375": "Dinosaur Park [shooting ball for 2 people]",
  "junior-Y11376": "Zombie Adventure-4 Players Shooting Balls",
  "junior-Y11377": "Zombie Adventure [3 Players Shooting Balls]",
  "junior-Y11378": "Mecha Battle-4 Players Shooting Balls",
  "junior-Y11379": "Mecha Battle-2 Players Shooting Balls",
  "junior-Y10542": "Mining trolley (contains 30 ores)",
  "junior-Y10539": "Shachi District",
  "junior-Y10540": "Shachi District",
  "junior-Y30884": "triangular igloo",
  "junior-Y30885": "Eskimo igloo",
  "junior-Y10640": "Dentist chair",
  "junior-Y10636": "Dentist chair set",
  "junior-Y10637": "Multifunctional hospital cabinet",
  "junior-Y10638": "medical stool",
  "junior-Y10639": "CT machine",
  "junior-Y10605": "Chair",
  "junior-Y10608": "hospital rest bed",
  "junior-Y10611": "medical storage rack",
  "junior-Y10612": "Medical consultation desk",
  "junior-Y10613": "blue pink consultation table",
  "junior-Y10614": "Red and white consultation desk",
  "junior-Y10615": "Hospital consultation desk",
  "junior-Y10616": "Corner consultation desk",
  "junior-Y10619": "Medicine display cabinet",
  "junior-Y10620": "medicine cabinet",
  "junior-Y10623": "multifunctional wardrobe",
  "junior-Y10624": "operating table",
  "junior-Y10625": "simulated magnetic resonance machine",
  "junior-Y10626": "doctor wardrobe",
  "junior-Y10627": "CT machine",
  "junior-Y10628": "X-ray machine",
  "junior-Y10629": "love hanger",
  "junior-Y10630": "Dentist chair",
  "junior-Y10631": "Semicircular medical cabinet",
  "junior-Y10632": "Love consultation desk",
  "junior-Y10606": "rainbow hanger",
  "junior-Y10633": "hospital medicine cabinet",
  "junior-Y10634": "NMR",
  "junior-Y10635": "medicine cabinet",
  "junior-Y10641": "CT machine (with screen)",
  "junior-Y10642": "hospital wardrobe",
  "junior-Y10643": "Consultation desk (with screen)",
  "junior-Y10644": "Acrylic medicine cabinet",
  "junior-Y10645": "hospital stool",
  "junior-Y10646": "Acrylic medicine cabinet (large size)",
  "junior-Y10647": "Consultation table L-shaped (with screen)",
  "junior-Y10650": "Drug acceptance desk",
  "junior-Y10651": "Drug recycling bin",
  "junior-Y10652": "Electronic registration machine",
  "junior-Y10653": "semicircle storage rack",
  "junior-Y10654": "Square round table-1",
  "junior-Y10660": "Square round table-2",
  "junior-Y10655": "Corner table-1",
  "junior-Y10661": "Corner table-2",
  "junior-Y10656": "three-seat chair",
  "junior-Y10657": "Pill chair (large)",
  "junior-Y10662": "Pill chair (small)",
  "junior-Y10658": "capsule chair",
  "junior-Y10659": "Pill Table-1",
  "junior-Y10663": "Pill Table-2",
  "junior-Y10701": "pet house",
  "junior-Y10702": "pet storage cabinet",
  "junior-Y10703": "petal pet climbing frame",
  "junior-Y10704": "pet cabinet",
  "junior-Y10705": "Pet consultation desk",
  "junior-Y10709": "pet climbing frame",
  "junior-Y10713": "sofa",
  "junior-Y10732": "Pet station",
  "junior-Y10801": "BBQ station",
  "junior-Y10802": "Hot pot display table",
  "junior-Y10803": "Shaped mandarin duck hot pot table (with light)",
  "junior-Y10804": "hotpot stool",
  "junior-Y10805": "Hot pot placing table",
  "junior-Y10807": "Curved combination table",
  "junior-Y10808": "Roast duck stove with seat",
  "junior-Y10809": "Rotating duck oven",
  "junior-Y10810": "Roast duck shop",
  "junior-Y10811": "Fun Hot Pot_Hot Pot Table",
  "junior-Y10812": "Fun Hot Pot_Ingredients Area",
  "junior-Y10813": "Fun Hot Pot_Soup Wall",
  "junior-Y10916": "Thermal Research Institute (two colors)",
  "junior-Y10918": "Milk tea ingredients table",
  "junior-Y10919": "milk tea decoration table",
  "junior-Y10920": "Milk tea check-in counter",
  "junior-Y10921": "Milk tea front desk",
  "junior-Y10922": "Bubble point single table",
  "junior-Y10923": "Milk tea bench",
  "junior-Y10925": "Run French Fries - Dip Bottle",
  "junior-Y10926": "Run French Fries-French Fries Box",
  "junior-Y10928": "coffee kiosk",
  "junior-Y10929": "high chair",
  "junior-Y10930": "revolving sushi table",
  "junior-Y10931": "Shape top",
  "junior-Y10917": "candy cart",
  "junior-Y10902": "Bread stand cabinet",
  "junior-Y10904": "coffee house",
  "junior-Y10905": "Bread island cabinet",
  "junior-Y10906": "Bread stand cabinet",
  "junior-Y10907": "pallet rack",
  "junior-Y10915": "food outlet",
  "junior-Y11135": "Building block shelf",
  "junior-Y11104": "Special-shaped building block table",
  "junior-Y11105": "Oval building block table",
  "junior-Y11106": "Square building block table",
  "junior-Y11107": "round toy table",
  "junior-Y11108": "round toy table",
  "junior-Y11109": "Styling building block table",
  "junior-Y11110": "Semicircular long building block table",
  "junior-Y11111": "Oval toy table",
  "junior-Y11117": "desktop racing",
  "junior-Y11131": "Luminous building blocks",
  "junior-Y11132": "building block table",
  "junior-Y11133": "stool",
  "junior-Y11137": "Truck Toy Table Set",
  "junior-Y11138": "Cloud building block wall a",
  "junior-Y11139": "Screw building block wall b",
  "junior-Y11140": "truck game tablea",
  "junior-Y11141": "DIY billboard a",
  "junior-Y11142": "Cloud toy table combination",
  "junior-Y11143": "Cloud building block wall c",
  "junior-Y11144": "Rainbow building block wall d",
  "junior-Y11145": "Cloud game table b",
  "junior-Y11146": "DIY billboard b",
  "junior-Y11121": "KTV audio",
  "junior-Y11010": "ball sports",
  "junior-Y11011": "Water Technology/Water Lebao",
  "junior-Y10733": "simulated cow",
  "junior-Y10736": "Simulated cow bucket",
  "junior-Y10734": "Imitation sheep",
  "junior-Y10721": "big cow",
  "junior-Y10722": "baby cow",
  "junior-Y10723": "Baby bottle storage box",
  "junior-Y10727": "Ranch Windmill Cabinet",
  "junior-Y10728": "Ranch wall hanger",
  "junior-Y10729": "Ranch milk table",
  "junior-Y10747": "big cow",
  "junior-Y10748": "baby cow",
  "junior-Y10749": "cow screen",
  "junior-Y10750": "pet supplies display stand",
  "junior-Y10751": "pet food display stand",
  "junior-Y10752": "Pet stroller backpack display stand",
  "junior-Y10753": "CT machine",
  "junior-Y10754": "Operating table (2 pieces per pair)",
  "junior-Y10755": "storage rack",
  "junior-Y10756": "Chicken lays eggs 3.0",
  "junior-Y10735": "Chickens lay eggs (upgraded touch screen version)",
  "junior-Y10714": "Chicken lays eggs",
  "junior-Y10715": "Chicken and egg combination",
  "junior-Y10730": "Chickens lay eggs (8 chickens)",
  "junior-Y10731": "Chickens lay eggs (10 chickens)",
  "junior-Y10737": "Soft bag picking",
  "junior-Y10744": "Soft bag picking combination 2",
  "junior-Y10738": "Upgraded fishing rod holder",
  "junior-Y10739": "Fruit and vegetable identification machine in picking area",
  "junior-Y10740": "Picking area storage rack",
  "junior-Y10742": "Seed touch box-unit card type",
  "junior-Y10743": "Seed touch box-three card model",
  "junior-Y10745": "Round fish tank (four holes)",
  "junior-Y10741": "semicircle fish tank",
  "junior-Y11128": "Regular version of Ferris wheel",
  "junior-Y11129": "Ferris wheel in space",
  "junior-Y11130": "Ferris wheel in space",
  "junior-Y30889": "Soft carousel",
  "junior-Y30892": "Whale Fountain Carousel",
  "junior-Y30871": "space trojan",
  "junior-Y30872": "Sydney Trojan",
  "junior-Y30873": "Apple Trojan",
  "junior-Y30874": "Banana Trojan",
  "junior-Y30875": "Champagne Trojan",
  "junior-Y30876": "Princess Pink Trojan",
  "junior-Y30877": "royal blue horse",
  "junior-Y30878": "Little Rocket Trojan",
  "junior-Y30879": "flat-top rocking horse",
  "junior-Y30880": "Planet Trojan",
  "junior-Y30881": "MINI PIG Trojan",
  "junior-Y30890": "steeple carousel",
  "junior-Y30902": "Carousel-Cake",
  "junior-Y30891": "Cake Party Carousel",
  "junior-Y30893": "Sunshine Bee Carousel - No pedals",
  "junior-Y30894": "Sunshine Bee Carousel - including pedals)",
  "junior-Y30895": "Mushroom Forest Carousel",
  "junior-Y30896": "Take a bite of the Mushroom Carousel",
  "junior-Y30897": "Delicious pizza carousel",
  "junior-Y30898": "Sunny carousel after rain",
  "junior-Y30900": "Hand-Crank Train (Square)",
  "junior-Y30901": "Hand-Crank Train (Special)",
  "junior-Y30886": "space train",
  "junior-Y30882": "retro train",
  "junior-Y30883": "INI PIG train",
  "senior-Y11209": "climbing ball",
  "senior-Y11210": "Block climbing",
  "senior-Y11211": "round backgammon",
  "senior-Y11212": "square backgammon",
  "senior-Y11213": "color block rock climbing",
  "senior-Y11214": "Rainbow Stair Climbing",
  "senior-Y11215": "pipe splicing rock climbing",
  "senior-Y11216": "alphabet climbing",
  "senior-Y11217": "chip climbing",
  "senior-Y11218": "Competitive rock climbing",
  "senior-Y11136": "football field",
  "senior-Y11012": "bouncy castle",
  "senior-Y11013": "Small ball sports-piano model",
  "senior-Y11014": "Small ball sports-spaceship model",
  "senior-Y11015": "Small ball sports-bud model",
  "senior-Y11016": "Small ball sports-road sign model",
  "senior-Y11017": "Small ball sports-green plant model",
  "senior-Y11018": "Small Ball Sports-Safety Lab",
  "senior-Y11019": "Small ball sports-star wall",
  "senior-Y11020": "Small ball sports-Archimedes screw ball machine",
  "senior-Y11330": "Interactive ball smashing",
  "senior-Y11331": "Fun slide",
  "senior-Y11347": "Ma Liang, the magic pen",
  "senior-Y11356": "Interactive graffiti screen version",
  "senior-Y11357": "Interactive graffiti projection version",
  "senior-Y11349": "Robot drawing",
  "senior-Y11351": "Interactive sparring-adult version",
  "senior-Y11352": "Interactive sparring - children's version",
  "senior-Y11353": "Technology happy jumping (single unit)",
  "senior-Y11354": "Technology Elite Rowing (Single Unit)",
  "senior-Y11355": "Technology interactive rolling ball projection version (set of two)",
  "senior-Y11381": "Dream Travel",
  "senior-Y11382": "Heavenly General and Gun King",
  "senior-Y11383": "Projection bounce ball",
  "senior-Y11384": "interactive football",
  "senior-Y11385": "interactive football",
  "senior-Y11387": "flash shot",
  "senior-Y11388": "Jumping with joy",
  "senior-Y11389": "Carrot Rabbit Trampoline",
  "senior-Y11390": "Wireless Robotic Trampoline",
  "senior-Y11391": "Triangular Robot Trampoline",
  "senior-Y11392": "Super Dimension-Screen Model",
  "senior-Y11393": "Super Dimension-Projection Model",
  "senior-Y11394": "Star Basketball Special Training Camp-Halftime",
  "senior-Y11395": "Light and shadow play platform",
  "senior-Y11396": "Chasing the Light Breakout Battle",
  "senior-Y11397": "light field pitcher",
  "senior-Y11398": "light grid party",
  "senior-Y11399": "Jubilation Cube",
  "senior-Y113100": "Light and shadow kart",
  "senior-Y113101": "interactive football",
  "senior-Y113102": "Happy Puttball",
  "senior-Y113103": "Rhythm Blitz",
  "senior-Y113104": "Competition in the arena",
  "senior-Y113105": "Galaxy Meteor Fist",
  "senior-Y113106": "devil basketball",
  "senior-Y113107": "Fantasy Paradise",
  "senior-Y113108": "Basketball Story 3 screen",
  "senior-Y113109": "Basketball Story 5 screens",
  "senior-Y113110": "shooting contest",
  "senior-Y113111": "rock climbing challenge",
  "senior-Y113112": "time traveler",
  "senior-Y113113": "box equation",
  "senior-Y113117": "Light and shadow party",
  "senior-Y113118": "Light and Shadow Sports Hall",
  "senior-Y113119": "Trampoline throwing sandbags",
  "senior-Y113120": "wall pat music",
  "senior-Y113121": "Paipai Lamp-Sweet Honey",
  "senior-Y113122": "Pat lamp-bell money jar",
  "senior-Y113123": "Paipa Lamp-Pinpinle",
  "senior-Y113124": "Pat the light-race against time",
  "senior-Y113125": "Paipa Lamp - Variety Turtle",
  "senior-Y113126": "Paipa Lamp-Happy Planet",
  "senior-Y113127": "beat master",
  "senior-Y113128": "Projection Smashing Ball Type A",
  "senior-Y113129": "Projection Smashing Ball Model B",
  "senior-Y113130": "VR chariot water horse fence",
  "senior-Y113131": "MR tank",
  "senior-Y113132": "Happy Ride-Two persons",
  "senior-Y113133": "Happy Ride-Four People",
  "senior-Y113134": "Riding Wonderful Journey-Two persons",
  "senior-Y113135": "Riding Wonderful Journey-Four People",
  "senior-Y113136": "Fantasy Paradise-Screen Version",
  "senior-Y113137": "Phantom Dynamic World-Screen Version",
  "senior-Y113138": "Happy Push Ball-Projection Model",
  "senior-Y113139": "Interactive ball smashing",
  "senior-Y113140": "interactive slide",
  "senior-Y113141": "Miracle Brush",
  "senior-Y113142": "QiLv Swing-Rainbow Style",
  "senior-Y113143": "Interactive punch-in system",
  "senior-Y113144": "Smart sensing wall",
  "senior-Y113145": "jump zone",
  "senior-Y113146": "QiLv Swing-Dazzle Model",
  "senior-Y113147": "Qilu Swing-Dinosaur Style",
  "senior-Y11319": "Eliminate small squares of ground",
  "senior-Y11350": "Competitive elimination of small squares on the ground and walls",
  "senior-Y11314": "Somatosensory trampoline",
  "senior-Y11308": "MINI parent-child",
  "senior-Y11329": "Fun Bowling",
  "senior-Y11358": "speed bowling",
  "senior-Y11359": "Children's bowling ball 6 meters long",
  "senior-Y11309": "Parenting standards",
  "senior-Y11310": "adult bowling",
  "senior-Y11360": "Crazy animal racing",
  "senior-Y11361": "Cool running car",
  "senior-Y11362": "Furious pursuit",
  "senior-Y11363": "air force one",
  "senior-Y11364": "ace flight crew",
  "senior-Y11365": "Dynamic rowing",
  "senior-Y11366": "surfer",
  "senior-Y11367": "Hot basketball",
  "senior-Y11368": "Basketball Wizard",
  "senior-Y11369": "Deep Sea Fishing 2",
  "senior-Y11311": "simulated golf",
  "senior-Y11312": "simulated football",
  "senior-Y11313": "digital rock climbing",
  "senior-Y11315": "Interactive Basketball-Children's Edition (3P)",
  "senior-Y11316": "Video Basketball (5P)",
  "senior-Y11317": "moving target archery",
  "senior-Y11318": "boxing",
  "senior-Y11320": "digital tennis",
  "senior-Y11321": "Deluxe version of dart machine",
  "senior-Y11322": "crazy bird",
  "senior-Y11323": "curling ball",
  "senior-Y11324": "single ski",
  "senior-Y11328": "Ring screen spinning bike",
  "senior-Y11302": "INI Racecourse (1P)",
  "senior-Y11303": "INI Racecourse (2P)",
  "senior-Y11304": "INI Racecourse (4P)",
  "senior-Y11305": "Adult Racecourse (1P)",
  "senior-Y11306": "Adult Racecourse (2P)",
  "senior-Y11307": "Adult Racecourse (4P)",
  "senior-Y11325": "throwing rugby",
  "senior-Y11326": "supree fashion",
  "senior-Y11327": "Children's basketball machine",
  "senior-Y11332": "mini two track",
  "senior-Y11333": "luxury four lanes",
  "senior-Y11334": "luxury four lanes",
  "senior-Y11335": "luxury four lanes",
  "senior-Y11336": "360 extreme travel",
  "senior-Y11337": "Space-time motorcycle",
  "senior-Y11338": "360 extreme travel",
  "senior-Y11339": "9DVR-fourth generation",
  "senior-Y11340": "Two people time and space",
  "senior-Y11341": "Four-person VR theater 3.0",
  "senior-Y11342": "Time Shuttle 3.0",
  "senior-Y11343": "time warrior",
  "senior-Y11344": "Knight of Time and Space",
  "senior-Y11345": "VR three screens",
  "senior-Y11346": "Sniper Elite",
};
const englishProductName = (p: Pick<Product, "id" | "en">) => {
  const translated =
    (!/[\u4e00-\u9fff]/.test(p.en) && p.en.trim()) ||
    englishNameByProductId[p.id] ||
    p.en.trim() ||
    "English translation unavailable";
  return translated.replace(/^([^A-Za-z]*)([a-z])/, (_, prefix: string, letter: string) =>
    `${prefix}${letter.toUpperCase()}`,
  );
};
const needsEnglishTranslation = (p: Pick<Product, "id" | "en">) =>
  !englishNameByProductId[p.id] && (!p.en.trim() || /[\u4e00-\u9fff]/.test(p.en));
const quoteArea = (p: Product) => {
  if (p.importArea) return p.importArea;
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
  if (!p.category2 || /^(未细分|未分类|自定义产品)$/.test(p.category2))
    return "其他产品 / Other Products";
  return `${p.category2} / Experience Area`;
};
const hospitalToyNavigationGroups: Record<"常规医院" | "未来医院", string[]> = {
  "常规医院": ["医院区", "医院区（英文版）"],
  "未来医院": ["未来医院区", "未来医院区（英文版）"],
} as const;
const hospitalPairingGroups = {
  regular: ["医院区"],
  english: ["医院区（英文版）"],
  future: ["未来医院区", "未来医院区（英文版）"],
} as const;
type HospitalPairingGroup = keyof typeof hospitalPairingGroups;
const hospitalPairingGroupLabels: Record<
  HospitalPairingGroup,
  { tab: string; title: string; empty: string }
> = {
  regular: { tab: "常规", title: "常规医院玩具", empty: "暂无常规医院玩具。" },
  english: { tab: "英文", title: "英文版医院玩具", empty: "暂无英文版医院玩具。" },
  future: { tab: "未来", title: "未来医院玩具", empty: "暂无未来医院玩具。" },
};
const hospitalToySourceCategories = new Set(
  Object.values(hospitalToyNavigationGroups).flat(),
);
const importedSkuCodes = (value: unknown) => {
  const text = String(value || "").trim().toUpperCase();
  if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(text)) return [text];
  return text.match(/(?:FB|Y)\d+(?:-[A-Z0-9]+)?/g) || [];
};
const importCellText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const importCellNumber = (value: unknown) => {
  const text = importCellText(value);
  if (!text) return null;
  const parsed = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const findImportColumn = (header: string[], pattern: RegExp) =>
  header.findIndex((cell) => pattern.test(cell));
const findImportMeta = (rows: unknown[][], headerIndex: number, pattern: RegExp) => {
  for (let rowIndex = 0; rowIndex < headerIndex; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const label = importCellText(String(row[columnIndex] ?? "").split("\n")[0]);
      if (!pattern.test(label)) continue;
      const inline = label.split(/[：:]/).slice(1).join(":").trim();
      if (inline) return inline;
      const candidates = [
        rows[rowIndex + 1]?.[columnIndex],
        row[columnIndex + 1],
        rows[rowIndex + 1]?.[columnIndex + 1],
      ];
      const value = candidates.map(importCellText).find(Boolean);
      if (value) return value;
    }
  }
  return "";
};
const findImportMetaLocation = (
  rows: unknown[][],
  headerIndex: number,
  pattern: RegExp,
) => {
  for (let rowIndex = 0; rowIndex < headerIndex; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (!pattern.test(importCellText(row[columnIndex]))) continue;
      const candidates = [
        [rowIndex + 1, columnIndex],
        [rowIndex, columnIndex + 1],
        [rowIndex + 1, columnIndex + 1],
      ] as const;
      const location = candidates.find(([candidateRow, candidateColumn]) =>
        Boolean(importCellText(rows[candidateRow]?.[candidateColumn])),
      );
      if (location)
        return { row: location[0], column: location[1] };
    }
  }
  return undefined;
};
const inferImportProjectName = (rows: unknown[][], headerIndex: number) => {
  const title = rows
    .slice(0, headerIndex)
    .flat()
    .map(value => importCellText(String(value ?? "").split("\n")[0]))
    .find((cell) => /quotation|报价/i.test(cell));
  if (!title) return "";
  const withoutQuotation = title.replace(/&?\s*(quotation|报价单).*/i, "");
  return withoutQuotation
    .split(/[+｜|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1) || "";
};
const imageMimeType = (path: string) =>
  /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.gif$/i.test(path) ? "image/gif" : "image/png";
const extractWorkbookImages = (data: ArrayBuffer) => {
  const images = new Map<string, Blob>();
  try {
    const archive = XLSX.CFB.read(new Uint8Array(data), { type: "array" });
    const fileBySuffix = (suffix: string) => {
      const index = archive.FullPaths.findIndex((path: string) => path.endsWith(suffix));
      return index >= 0 ? archive.FileIndex[index]?.content : undefined;
    };
    const cellImages = fileBySuffix("xl/cellimages.xml");
    const imageRelations = fileBySuffix("xl/_rels/cellimages.xml.rels");
    if (!cellImages || !imageRelations) return images;
    const decode = (content: unknown) =>
      new TextDecoder().decode(content as Uint8Array);
    const relationMap = new Map<string, string>();
    for (const match of decode(imageRelations).matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g))
      relationMap.set(match[1], match[2]);
    for (const match of decode(cellImages).matchAll(/<etc:cellImage>[\s\S]*?<xdr:cNvPr[^>]*name="([^"]+)"[\s\S]*?<a:blip r:embed="([^"]+)"[\s\S]*?<\/etc:cellImage>/g)) {
      const path = relationMap.get(match[2]);
      if (!path) continue;
      const image = fileBySuffix(`xl/${path.replace(/^\.\//, "")}`);
      if (image) images.set(match[1], new Blob([image as BlobPart], { type: imageMimeType(path) }));
    }
  } catch {
    // .xls and .csv files do not contain the .xlsx image package.
  }
  return images;
};
const skuImageKey = (sku: string) => sku.trim().toUpperCase().replace(/\s+/g, "");
const xmlText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// WPS requires cells in column order, including cells restored into older templates.
const normalizeTemplateCellOrder = (xml: string) =>
  xml.replace(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (row) => {
    const cellPattern = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
    const cells = [...row.matchAll(cellPattern)].map(([cell]) => cell);
    const column = (cell: string) => XLSX.utils.decode_cell(cell.match(/\br="([A-Z]+\d+)"/)![1]).c;
    cells.sort((a, b) => column(a) - column(b));
    let index = 0;
    return row.replace(cellPattern, () => cells[index++]);
  });
const formatQuoteCurrencyCells = (files: Record<string, Uint8Array>, xml: string, headerRow: number, columns: number[]) => {
  if (files["xl/styles.xml"]) {
    let styles = strFromU8(files["xl/styles.xml"]).replace(/<numFmt\b[^>]*\/>/g, tag => /[$￥¥]/.test(tag) ? tag.replace(/#,##0(?:\.0+)?/g, "#,##0.00") : tag);
    const group = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (group) {
      const formats = [...group[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(([xf]) => xf);
      const cnyColumns = new Set(columns.filter(column => column >= 0));
      xml = xml.replace(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g, cell => {
        const ref = cell.match(/\br="([A-Z]+)(\d+)"/);
        if (!ref || Number(ref[2]) <= headerRow || !cnyColumns.has(XLSX.utils.decode_col(ref[1])) || /\bt="(?:s|inlineStr|str)"/.test(cell) || !/<v>[-\d.]+<\/v>/.test(cell)) return cell;
        const original = formats[Number(cell.match(/\bs="(\d+)"/)?.[1] || 0)];
        if (!original) return cell;
        const next = original.replace(/\bnumFmtId="\d+"/, 'numFmtId="4"').replace(/\bapplyNumberFormat="[^"]*"/, 'applyNumberFormat="1"');
        let index = formats.indexOf(next);
        if (index < 0) {index = formats.length; formats.push(next);}
        return cell.replace(/<c\b([^>]*)>/, (_, attrs: string) => `<c${attrs.replace(/\s+s="[^"]*"/, "")} s="${index}">`);
      });
      styles = styles.replace(group[0], `<cellXfs count="${formats.length}">${formats.join("")}</cellXfs>`);
    }
    files["xl/styles.xml"] = strToU8(styles);
  }
  return xml;
};
// Older exports recreated some price cells without their formatting.
const restoreTemplatePriceStyles = (
  xml: string,
  rows: Set<number>,
  pairs: Array<[number, number]>,
) => xml.replace(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (row) => {
  if (!rows.has(Number(row.match(/\br="(\d+)"/)?.[1]))) return row;
  const styles = new Map<number, string>();
  for (const [cell] of row.matchAll(/<c\b[^>]*>/g)) {
    const ref = cell.match(/\br="([A-Z]+\d+)"/)?.[1];
    const style = cell.match(/\bs="(\d+)"/)?.[1];
    if (ref && style) styles.set(XLSX.utils.decode_cell(ref).c, style);
  }
  return row.replace(/<c\b[^>]*>/g, (cell) => {
    if (/\bs="/.test(cell)) return cell;
    const ref = cell.match(/\br="([A-Z]+\d+)"/)?.[1];
    const column = ref ? XLSX.utils.decode_cell(ref).c : -1;
    const sibling = pairs.find(([a, b]) => a >= 0 && b >= 0 && (column === a || column === b));
    const style = sibling && styles.get(sibling[0] === column ? sibling[1] : sibling[0]);
    return style ? cell.replace(/(\/?>)$/, ` s="${style}"$1`) : cell;
  });
});
const updateTemplateCell = (
  xml: string,
  cellRef: string,
  value: string | number,
) => {
  const rowNumber = XLSX.utils.decode_cell(cellRef).r + 1;
  const rowPattern = new RegExp(`(<row\\b[^>]*\\br="${rowNumber}"[^>]*>)([\\s\\S]*?)(</row>)`);
  return xml.replace(rowPattern, (_row, rowStart, rowContent, rowEnd) => {
    const cellPattern = new RegExp(
      `<c\\b([^>]*\\br="${cellRef}"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`,
    );
    const nextCell = (attributes: string, existing = "") => {
      const cleanAttributes = attributes
        .replace(/\s+t="[^"]*"/g, "")
        .replace(/\/\s*$/, "");
      if (typeof value === "string")
        return `<c${cleanAttributes} t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
      const formula = existing.match(/<f[^>]*>[\s\S]*?<\/f>/)?.[0] || "";
      return `<c${cleanAttributes}>${formula}<v>${value}</v></c>`;
    };
    if (cellPattern.test(rowContent))
      return `${rowStart}${rowContent.replace(cellPattern, (cell: string, attributes: string) => nextCell(attributes, cell))}${rowEnd}`;
    return `${rowStart}${rowContent}${nextCell(` r="${cellRef}"`)}${rowEnd}`;
  });
};
const updateTemplateFormula = (
  xml: string,
  cellRef: string,
  formula: string,
  value: number,
) => {
  const rowNumber = XLSX.utils.decode_cell(cellRef).r + 1;
  const rowPattern = new RegExp(`(<row\\b[^>]*\\br="${rowNumber}"[^>]*>)([\\s\\S]*?)(</row>)`);
  return xml.replace(rowPattern, (_row, rowStart, rowContent, rowEnd) => {
    const cellPattern = new RegExp(
      `<c\\b([^>]*\\br="${cellRef}"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`,
    );
    const nextCell = (attributes: string) => {
      const cleanAttributes = attributes
        .replace(/\s+t="[^"]*"/g, "")
        .replace(/\/\s*$/, "");
      return `<c${cleanAttributes}><f>${xmlText(formula.replace(/^=/, ""))}</f><v>${value}</v></c>`;
    };
    if (cellPattern.test(rowContent))
      return `${rowStart}${rowContent.replace(cellPattern, (_cell: string, attributes: string) => nextCell(attributes))}${rowEnd}`;
    return `${rowStart}${rowContent}${nextCell(` r="${cellRef}"`)}${rowEnd}`;
  });
};
const templateRow = (xml: string, sourceRow: number, targetRow: number) =>
  xml
    .replace(new RegExp(`(<row\\b[^>]*\\br=")${sourceRow}("[^>]*>)`), `$1${targetRow}$2`)
    .replace(new RegExp(`\\br="([A-Z]+)${sourceRow}"`, "g"), `r="$1${targetRow}"`);
const setTemplateHiddenColumns = (xml: string, hiddenColumns: Set<number>) =>
  xml.replace(/<cols>([\s\S]*?)<\/cols>/, (_columns, body: string) => {
    const definitions = [...body.matchAll(/<col\b([^>]*)\/>/g)].map((match) => {
      const attributes = match[1];
      const min = Number(attributes.match(/\bmin="(\d+)"/)?.[1] || 0);
      const max = Number(attributes.match(/\bmax="(\d+)"/)?.[1] || min);
      return { min, max, attributes };
    });
    const attributesFor = (column: number) => {
      const source = definitions.find((definition) =>
        column >= definition.min && column <= definition.max,
      )?.attributes || "";
      return source
        .replace(/\s+min="[^"]*"/g, "")
        .replace(/\s+max="[^"]*"/g, "")
        .replace(/\s+hidden="[^"]*"/g, "");
    };
    const visibleColumns = Array.from({ length: 19 }, (_, index) => {
      const column = index + 1;
      return `<col min="${column}" max="${column}"${attributesFor(column)}${hiddenColumns.has(column) ? ' hidden="1"' : ""}/>`;
    });
    const remainingColumns = definitions
      .filter((definition) => definition.max > 19)
      .map((definition) => `<col${definition.attributes}/>`);
    return `<cols>${[...visibleColumns, ...remainingColumns].join("")}</cols>`;
  });
const updateTemplateRowCell = (
  rowXml: string,
  row: number,
  column: number,
  value: string | number,
) =>
  updateTemplateCell(
    rowXml,
    XLSX.utils.encode_cell({ r: row - 1, c: column }),
    value,
  );
const updateTemplateRowFormula = (
  rowXml: string,
  row: number,
  column: number,
  formula: string,
  value: number,
) =>
  updateTemplateFormula(
    rowXml,
    XLSX.utils.encode_cell({ r: row - 1, c: column }),
    formula,
    value,
  );
const updateTemplateRowTextFormula = (
  rowXml: string,
  row: number,
  column: number,
  formula: string,
) => {
  const cellRef = XLSX.utils.encode_cell({ r: row - 1, c: column });
  const cellPattern = new RegExp(
    `<c\\b([^>]*\\br="${cellRef}"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`,
  );
  const formulaCell = (attributes: string) => {
    const cleanAttributes = attributes
      .replace(/\s+t="[^"]*"/g, "")
      .replace(/\/\s*$/, "");
    const value = xmlText(formula);
    return `<c${cleanAttributes} t="str"><f>${value.replace(/^=/, "")}</f><v>${value}</v></c>`;
  };
  return cellPattern.test(rowXml)
    ? rowXml.replace(cellPattern, (_cell, attributes: string) => formulaCell(attributes))
    : rowXml.replace(
        /<\/row>$/,
        `${formulaCell(` r="${cellRef}"`)}</row>`,
      );
};
const downloadExcelFile = (data: Uint8Array | ArrayBuffer, fileName: string) => {
  const url = URL.createObjectURL(
    new Blob([data instanceof Uint8Array ? new Uint8Array(data).buffer : data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};
function Visual({
  p,
  mini = false,
  eager = false,
}: {
  p: Product;
  mini?: boolean;
  eager?: boolean;
}) {
  return p.image ? (
    <img src={p.image} alt={mini ? "" : p.name} loading={eager ? "eager" : "lazy"} />
  ) : (
    <span className="productFallback">{p.category2.slice(0, 4)}</span>
  );
}
function CompanyLogo({ className = "" }: { className?: string }) {
  return (
    <img
      className={`companyLogo ${className}`}
      src="/brand/yifun-life-logo.png?v=bb45e13732b7"
      alt="亦玩集团 Yifun Life"
    />
  );
}
function QuoteBilingual({ zh, en }: { zh: string; en: string }) {
  return (
    <span className="quoteBilingual">
      <span>{zh}</span>
      <small>{en}</small>
    </span>
  );
}
function PrintBilingual({ zh, en }: { zh: string; en: string }) {
  return (
    <span className="printBilingual">
      <span>{zh || "\u00a0"}</span>
      <span>{en || "\u00a0"}</span>
    </span>
  );
}
const splitBilingual = (value: string) => {
  const lines = value.split(/\n+/);
  const english = lines.filter(line => /[A-Za-z]/.test(line) && !/[\u4e00-\u9fff]/.test(line));
  if (lines.length > 1 && english.length && /[\u4e00-\u9fff]/.test(value))
    return {zh: lines.filter(line => !english.includes(line)).join("\n"), en: english.join("\n")};
  const [zh = "", ...englishParts] = value.split(/\s*\/\s*/);
  return { zh, en: englishParts.join(" / ") };
};
const englishRemark = (value: string) => {
  const { zh, en } = splitBilingual(value || "");
  if (en && !/[\u4e00-\u9fff]/.test(en)) return en;
  const remark = zh.trim();
  if (!remark || remark === "—") return "";
  if (/^三代触屏.*打印.*小票$/.test(remark))
    return "Third-generation touchscreen with receipt printer";
  const toyCount = remark.match(/^含玩具\s*(\d+)\s*个?$/);
  if (toyCount) return `Includes ${toyCount[1]} toys`;
  if (/^不含工具$/.test(remark)) return "Tools not included";
  if (/^如图$/.test(remark)) return "As shown";
  const terms: Array<[RegExp, string]> = [
    [/不含/g, "Excludes "],
    [/含有|包含|含/g, "Includes "],
    [/带有|配有|带/g, "with "],
    [/三代/g, "third-generation "],
    [/触屏|触摸屏/g, "touchscreen"],
    [/打印小票/g, "receipt printer"],
    [/显示屏/g, "display"],
    [/玩具/g, "toys"],
    [/套装/g, "set"],
    [/配件/g, "accessories"],
    [/工具/g, "tools"],
    [/颜色/g, "colour"],
    [/可选/g, "optional"],
    [/定制/g, "customised"],
    [/个/g, " pieces"],
  ];
  const translated = terms.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    remark,
  ).replace(/\s+/g, " ").trim();
  return /[\u4e00-\u9fff]/.test(translated) ? "Refer to Chinese remarks" : translated;
};
const printValue = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "\u00a0" : value;
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
                ? "银色"
                : hue < 18 || hue >= 345
                  ? value >= 0.7 && saturation <= 0.75
                    ? "粉"
                    : "红"
                  : hue < 48
                    ? "橙"
                    : hue < 72
                      ? "黄"
                      : hue < 165
                        ? "绿"
                        : hue < 195
                          ? "蓝"
                          : hue < 260
                            ? "蓝"
                            : "紫";
        if (!color) continue;
        counts[color] = (counts[color] || 0) + 1;
        counted++;
      }
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const [main, mainCount] = ranked[0] || [];
      const secondCount = ranked[1]?.[1] || 0;
      if (!main || !mainCount || mainCount / counted <= 0.3 || secondCount >= mainCount * 0.5)
        return resolve("未识别");
      resolve(main);
    };
    img.onerror = () => resolve("未识别");
    img.src = src;
  });
}
export default function Home() {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productClassifications, setProductClassifications] = useState<ProductClassification[]>([]);
  const [productTags, setProductTags] = useState<ProductTag[]>([]);
  const [relations, setRelations] = useState<ProductRelation[]>([]);
  const [kitchenPackageRecords, setKitchenPackageRecords] = useState<
    KitchenPackageRecord[]
  >([]);
  const [storedCatalogProducts, setStoredCatalogProducts] = useState<
    CatalogProduct[]
  >([]);
  const [kitchenMode, setKitchenMode] = useState<
    "packages" | "main" | "addons"
  >("main");
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
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [loginName, setLoginName] = useState("");
  const [loginPasswordConfirm, setLoginPasswordConfirm] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [authAccount, setAuthAccount] = useState<AuthAccount | null>(null);
  const isAdmin = authAccount?.role === "admin";
  const canViewQuoteCost = ["admin", "ceo", "cost_accountant"].includes(authAccount?.role || "");
  const [workplaceEntryId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("workplaceProject") || "");
  const [workspaceProjectId, setWorkspaceProjectId] = useState(workplaceEntryId);
  const [workplaceReady, setWorkplaceReady] = useState(!workplaceEntryId);
  const [workplaceNotice, setWorkplaceNotice] = useState("");
  const activeQuotationStorageKey = authAccount ? activeQuotationKey(authAccount.email) + (workplaceEntryId ? ":project:" + workplaceEntryId : "") : "";
  const canViewStaff = isAdmin || authAccount?.role === "management" || authAccount?.role === "ceo";
  const [employeeMenuOpen, setEmployeeMenuOpen] = useState(false);
  const [mobileCategoriesOpen, setMobileCategoriesOpen] = useState(false);
  const [pendingStaffCount, setPendingStaffCount] = useState(0);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [activeMajor, setActiveMajor] = useState<NavigationMajor>(
    navigationMajors[0],
  );
  const [expandedMajors, setExpandedMajors] = useState<Set<NavigationMajor>>(
    () => new Set([navigationMajors[0]]),
  );
  const [category, setCategory] = useState("全部产品");
  const [category3Filter, setCategory3Filter] = useState("");
  const [selectedCategoryKey, setSelectedCategoryKey] = useState("");
  const [navigationGroup, setNavigationGroup] =
    useState<NavigationGroup>("simulation");
  const [expandedProductGroups, setExpandedProductGroups] = useState<
    Set<string>
  >(() =>
    new Set(
      navigationMajors.flatMap((major) => [
        `${major}:simulation`,
        `${major}:toys`,
        ...(major === "大童类 / Older Children"
          ? [`${major}:拓展迷宫`, `${major}:滑梯`]
          : []),
      ]),
    ),
  );
  const [expandedToyCategories, setExpandedToyCategories] = useState<
    Set<string>
  >(new Set());
  const [query, setQuery] = useState("");
  const [colorFilter, setColorFilter] = useState("全部颜色");
  const [screenOnly, setScreenOnly] = useState(false);
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priceMode, setPriceMode] = useState<PriceMode>("vip");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [quoteQuantityDrafts, setQuoteQuantityDrafts] = useState<
    Record<string, string>
  >({});
  const [cartPairings, setCartPairings] = useState<
    Record<string, Record<string, number>>
  >({});
  const [selectedCartItemKeys, setSelectedCartItemKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [pairingSuggestion, setPairingSuggestion] =
    useState<PairingSuggestion | null>(null);
  const [pairingBatchQuantity, setPairingBatchQuantity] = useState("");
  const [collapsedHospitalPairingGroups, setCollapsedHospitalPairingGroups] =
    useState<Set<HospitalPairingGroup>>(() => new Set());
  const [pairingRemovalPrompt, setPairingRemovalPrompt] =
    useState<PairingRemovalPrompt | null>(null);
  const [quoteImportOpen, setQuoteImportOpen] = useState(false);
  const [quoteImportPreview, setQuoteImportPreview] =
    useState<QuoteImportPreview | null>(null);
  const [quoteImportError, setQuoteImportError] = useState("");
  const [quoteImportTranslationProgress, setQuoteImportTranslationProgress] = useState("");
  const [quoteImporting, setQuoteImporting] = useState(false);
  const [quoteImportDragging, setQuoteImportDragging] = useState(false);
  const [importedProducts, setImportedProducts] = useState<Product[]>([]);
  const [importedAreaOrder, setImportedAreaOrder] = useState<string[]>([]);
  const [importedQuotePairingOpen, setImportedQuotePairingOpen] = useState(false);
  const [selectedImportedProductId, setSelectedImportedProductId] = useState<string | null>(null);
  const [expandedImportedRelations, setExpandedImportedRelations] = useState<Set<string>>(new Set());
  const [imagePreviewProduct, setImagePreviewProduct] = useState<Product | null>(null);
  const [toyMatchingDraftId, setToyMatchingDraftId] = useState("");
  const [toyMatchingDrafts, setToyMatchingDrafts] = useState<ToyMatchingDraft[]>([]);
  const [toyMatchingOverview, setToyMatchingOverview] = useState(false);
  const [toyMatchingImportedListName, setToyMatchingImportedListName] = useState("");
  const [toyMatchingDraftSaving, setToyMatchingDraftSaving] = useState(false);
  const [matchingSkuPickerOpen, setMatchingSkuPickerOpen] = useState(false);
  const [matchingSkuQuery, setMatchingSkuQuery] = useState("");
  const [restoredQuoteProducts, setRestoredQuoteProducts] = useState<Product[]>([]);
  const quoteImportTemplateRef = useRef<QuoteImportTemplate | null>(null);
  const [quoteImportPriceMode, setQuoteImportPriceMode] =
    useState<QuoteImportPriceMode>("vip");
  const [editor, setEditor] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);
  const [tagDraftText, setTagDraftText] = useState("");
  const [relatedSearch, setRelatedSearch] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quotePreparing, setQuotePreparing] = useState(false);
  const [quoteActiveTab, setQuoteActiveTab] = useState("summary");
  const [quoteExpandedAreas, setQuoteExpandedAreas] = useState<Set<string>>(
    () => new Set(),
  );
  const [quoteProject, setQuoteProject] = useState("");
  const [quoteContractNo, setQuoteContractNo] = useState("");
  const [recordedQuoteHistoryId, setRecordedQuoteHistoryId] = useState("");
  const [quoteHistoryLineageId, setQuoteHistoryLineageId] = useState("");
  const [quoteHistoryNotice, setQuoteHistoryNotice] = useState("");
  const [quoteHistoryMode, setQuoteHistoryMode] = useState<QuoteHistoryMode>("new");
  const [pendingHistoryExport, setPendingHistoryExport] =
    useState<HistoryExportFormat | null>(null);
  const [quoteHistorySaving, setQuoteHistorySaving] = useState(false);
  const [designerName, setDesignerName] = useState("");
  const [salesName, setSalesName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [installationIncludesTravel, setInstallationIncludesTravel] =
    useState(true);
  const [includeTax, setIncludeTax] = useState(true);
  const [showDesignDeduction, setShowDesignDeduction] = useState(false);
  const [fees, setFees] = useState({
    packaging: 0,
    formaldehyde: 0,
    shipping: 0,
    installation: 0,
    designDeduction: 0,
  });
  const [activeQuotationRestored, setActiveQuotationRestored] = useState(false);
  useEffect(() => {
    if (auth !== "signedIn" || !activeQuotationRestored) return;
    if (!workspaceProjectId) { setWorkplaceReady(true); setWorkplaceNotice(""); return; }
    let canceled = false;
    setWorkplaceReady(false);
    setWorkplaceNotice("正在核对 Workplace 项目…");
    fetch("/api/workplace-project?id=" + encodeURIComponent(workspaceProjectId))
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "项目连接失败"); return data.project; })
      .then(project => { if (canceled) return; if (quoteHistoryMode === "new") setQuoteProject(project.name); setWorkplaceReady(true); setWorkplaceNotice("已关联 Workplace：" + project.customerName + " · " + project.name); })
      .catch(error => { if (!canceled) setWorkplaceNotice(error.message); });
    return () => { canceled = true; };
  }, [auth, activeQuotationRestored, workspaceProjectId, quoteHistoryMode]);
  const colorScanInFlight = useRef(new Set<string>());
  const colorScannedThisRun = useRef(new Set<string>());
  const rescanAllColours =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("rescanColours") === "1";
  const organizeToyTiers =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("organizeToyTiers") ===
      "1";
  const organizePairedAreas =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("organizePairedAreas") ===
      "1";
  const toyTierSyncStarted = useRef(false);
  const pairedAreaSyncStarted = useRef(false);
  const [toyTierSyncStatus, setToyTierSyncStatus] = useState("");
  const [pairedAreaSyncStatus, setPairedAreaSyncStatus] = useState("");
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) {
          if (d.mustChangePassword) { window.location.replace("/profile"); return; }
          const query = new URLSearchParams(window.location.search);
          if (
            d.role === "ceo" &&
            !query.has("catalog") &&
            !query.has("quotationHistory") && !query.has("workplaceProject")
          ) {
            window.location.replace("/ceo-dashboard");
            return;
          }
          setAuthAccount({ email: d.email, name: d.name, role: d.role, expiresAt: d.expiresAt });
          setAuth("signedIn");
        } else {
          setAuthMode(new URLSearchParams(window.location.search).get("reset") ? "reset" : "login");
          setAuth("signedOut");
        }
      })
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
          setProductClassifications(d.classifications || []);
          setProductTags(d.tags || []);
          setRelations(d.recommendations);
          setKitchenPackageRecords(d.packages || []);
        }
      })
      .catch(() => undefined);
  }, [auth]);
  useEffect(() => {
    if (auth !== "signedIn" || !activeQuotationStorageKey || activeQuotationRestored) return;
    try {
      const saved = window.localStorage.getItem(activeQuotationStorageKey);
      const snapshot = saved ? JSON.parse(saved) as Partial<QuoteHistorySnapshot> : null;
      if (snapshot?.version === 1) {
        setWorkspaceProjectId(snapshot.workspaceProjectId || workplaceEntryId);
        quoteImportTemplateRef.current = snapshot.importTemplate || null;
        setCart(snapshot.cart || {});
        setCartPairings(snapshot.cartPairings || {});
        setImportedProducts(snapshot.importedProducts || []);
        setRestoredQuoteProducts(snapshot.products || []);
        setImportedAreaOrder(snapshot.importedAreaOrder || []);
        setPriceMode(["factory", "vip", "usd"].includes(snapshot.priceMode || "") ? snapshot.priceMode as PriceMode : "vip");
        setQuoteProject(snapshot.projectName || "");
        setQuoteContractNo(snapshot.contractNo || "");
        setDesignerName(snapshot.designerName || "");
        setSalesName(snapshot.salesName || "");
        setCompanyAddress(snapshot.companyAddress || "");
        setInstallationIncludesTravel(snapshot.installationIncludesTravel !== false);
        setIncludeTax(snapshot.includeTax !== false);
        setShowDesignDeduction(Boolean(snapshot.showDesignDeduction));
        setFees({
          packaging: Number(snapshot.fees?.packaging) || 0,
          formaldehyde: Number(snapshot.fees?.formaldehyde) || 0,
          shipping: Number(snapshot.fees?.shipping) || 0,
          installation: Number(snapshot.fees?.installation) || 0,
          designDeduction: Number(snapshot.fees?.designDeduction) || 0,
        });
      }
    } catch {
      window.localStorage.removeItem(activeQuotationStorageKey);
    } finally {
      setActiveQuotationRestored(true);
    }
  }, [activeQuotationRestored, activeQuotationStorageKey, auth]);
  useEffect(() => {
    if (
      auth !== "signedIn" ||
      !activeQuotationRestored ||
      quoteHistoryMode !== "new" ||
      recordedQuoteHistoryId
    )
      return;
    if (!Object.keys(cart).length && !importedProducts.length) {
      window.localStorage.removeItem(activeQuotationStorageKey);
      return;
    }
    const snapshot: QuoteHistorySnapshot = {
      version: 1,
      importTemplate: storedQuoteTemplate(),
      products: restoredQuoteProducts,
      cart,
      cartPairings,
      importedProducts,
      importedAreaOrder,
      priceMode,
      workspaceProjectId: workspaceProjectId || undefined,
    projectName: quoteProject,
      contractNo: quoteContractNo,
      designerName,
      salesName,
      companyAddress,
      installationIncludesTravel,
      includeTax,
      showDesignDeduction,
      fees,
    };
    try {
      window.localStorage.setItem(activeQuotationStorageKey, JSON.stringify(snapshot));
    } catch {
      setQuoteImportError("浏览器空间不足，请保存草稿后再关闭页面。");
    }
  }, [
    activeQuotationRestored,
    activeQuotationStorageKey,
    auth,
    cart,
    cartPairings,
    companyAddress,
    designerName,
    fees,
    importedAreaOrder,
    importedProducts,
    restoredQuoteProducts,
    includeTax,
    installationIncludesTravel,
    priceMode,
    quoteContractNo,
    quoteHistoryMode,
    quoteProject,
    workspaceProjectId,
    recordedQuoteHistoryId,
    salesName,
    showDesignDeduction,
  ]);
  useEffect(() => {
    if (!employeeMenuOpen && !filtersOpen) return;
    const closeFloatingPanels = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("[data-employee-menu-surface]"))
        setEmployeeMenuOpen(false);
      if (!target.closest("[data-filter-surface]"))
        setFiltersOpen(false);
    };
    document.addEventListener("pointerdown", closeFloatingPanels);
    return () => document.removeEventListener("pointerdown", closeFloatingPanels);
  }, [employeeMenuOpen, filtersOpen]);
  useEffect(() => {
    if (auth !== "signedIn") return;
    const historyParams = new URLSearchParams(window.location.search);
    const historyId = historyParams.get("quotationHistory");
    if (!historyId) return;
    const mode = historyParams.get("mode") === "edit"
      ? "edit"
      : historyParams.get("mode") === "export"
        ? "export"
        : "view";
    const exportFormat = historyParams.get("format") === "pdf"
      ? "pdf"
      : historyParams.get("format") === "excel"
        ? "excel"
        : null;
    fetch(`/api/quotation-history?id=${encodeURIComponent(historyId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { quotation?: QuotationHistoryRecord } | null) => {
        if (data?.quotation) void restoreQuotation(data.quotation, mode, exportFormat);
        else window.alert("报价记录不存在，或你没有查看权限。");
      })
      .catch(() => window.alert("读取报价历史失败，请稍后重试。"));
  }, [auth]);
  useEffect(() => {
    if (
      auth !== "signedIn" ||
      !organizeToyTiers ||
      toyTierSyncStarted.current
    )
      return;
    toyTierSyncStarted.current = true;
    setToyTierSyncStatus("正在整理配套玩具的必配与选配目录…");
    fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "organizeToyTiers" }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (!result) throw new Error("Could not organize toy tiers");
        setToyTierSyncStatus(
          `已将 ${result.optionalSkuCount} 个配套玩具 SKU 归入选配`,
        );
        return fetch("/api/catalog");
      })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        setOverrides(data.overrides || []);
        setCategories(data.categories || []);
      })
      .catch(() => setToyTierSyncStatus("配套玩具目录整理失败，请重试。"));
  }, [auth, organizeToyTiers]);
  useEffect(() => {
    if (
      auth !== "signedIn" ||
      !organizePairedAreas ||
      pairedAreaSyncStarted.current
    )
      return;
    pairedAreaSyncStarted.current = true;
    setPairedAreaSyncStatus("正在统一模拟区与配套玩具的区域目录…");
    fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "organizePairedAreas" }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (!result) throw new Error("Could not organize paired areas");
        setPairedAreaSyncStatus(
          result.unresolvedAreas.length
            ? `已整理 ${result.updatedSkuCount} 个 SKU；待核对来源分类：${result.unresolvedAreas.join("、")}`
            : `已整理 ${result.updatedSkuCount} 个 SKU，模拟区与配套玩具区域已对应。`,
        );
        return fetch("/api/catalog");
      })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        setOverrides(data.overrides || []);
        setCategories(data.categories || []);
      })
      .catch(() =>
        setPairedAreaSyncStatus("区域目录整理失败，请刷新后重试。"),
      );
  }, [auth, organizePairedAreas]);
  const products = useMemo<Product[]>(
    () =>
      storedCatalogProducts.map((p) => {
        const o = overrides.find((x) => x.productId === p.id);
        const image = o?.imageUrl || p.image;
        const name = o?.name || p.name;
        const classifications = productClassifications.filter(
          (record) => record.productId === p.id,
        );
        const primaryClassification = classifications[0];
        const category1 = primaryClassification?.level2 ||
          o?.category1 || (p.family === "小玩具" ? "配套产品" : "模拟设备");
        const rawCategory2 = primaryClassification?.level3 || o?.category2 || p.category;
        const category2 = pairedArea(rawCategory2, name) || rawCategory2;
        const tags = productTags
          .filter((record) => record.productId === p.id)
          .map((record) => record.tag);
        const semanticTag =
          tags.find((tag) => ["主设备", "配套产品", "配套玩具", "广告类型", "地面/地胶"].includes(tag)) ||
          o?.category3 ||
          (p.family === "小玩具"
            ? "配套玩具"
            : isAccessoryProductName(name)
              ? "配套产品"
              : "主设备");
        const normalizedClassifications = classifications.length
          ? classifications
          : [{
              id: `classification-${p.id}`,
              productId: p.id,
              level1: o?.majorCategory || getMajorCategory(p),
              level2: category1,
              level3: rawCategory2,
            }];
        return {
          ...p,
          name,
          price:
            o?.price === undefined || o.price === null || o.price === ""
              ? p.price
              : Number(o.price),
          usd: p.usdExchangeRate === undefined ? p.usd : usdFromCny(p.factory, p.usdExchangeRate),
          image,
          spec: o?.specification ?? p.spec,
          unit: o?.unit ?? p.unit,
          volume: o?.volume || "",
          cost: o?.cost ?? null,
          branchPrice: o?.branchPrice ?? null,
          supplyMethod: o?.supplyMethod ?? null,
          stock: o?.stock ?? null,
          majorCategory: (primaryClassification?.level1 || o?.majorCategory || getMajorCategory(p)) as MajorCategory,
          category1,
          category2,
          category3: semanticTag,
          classifications: normalizedClassifications,
          tags: tags.length ? tags : [semanticTag],
          colorTag:
            isSpaceTheme(name, p.en)
              ? "银色"
              : semanticTag === "配套玩具"
              ? "不适用"
              : category1 === "模拟设备" && category2 === "消防区设备"
                  ? "红"
                : !image
                  ? "无主图"
                : category1 === "模拟设备"
                  ? normalizeColorTag(o?.colorTag || "待重新识别")
                  : normalizeColorTag(o?.colorTag || "未识别"),
          hasScreen:
            o?.hasScreen ??
            screenWords.test(`${p.name} ${p.spec} ${p.category}`),
          isRecommended: o?.isRecommended ?? false,
          relatedIds: relations
            .filter((r) => r.productId === p.id)
            .map((r) => r.relatedProductId),
        };
      }),
    [overrides, productClassifications, productTags, relations, storedCatalogProducts],
  );
  const productViews = useMemo<Product[]>(
    () => products.flatMap((product) =>
      product.classifications.map((record) => ({
        ...product,
        viewKey: `${product.id}:${record.id}`,
        majorCategory: record.level1 as MajorCategory,
        category1: record.level2,
        category2: pairedArea(record.level3, product.name) || record.level3,
      }))),
    [products],
  );
  useEffect(() => {
    const slots = 12 - colorScanInFlight.current.size;
    if (slots <= 0) return;
    products
      .filter(
        (p) =>
          p.category1 === "模拟设备" &&
          (p.colorTag === "待重新识别" || rescanAllColours) &&
          p.image &&
          p.category2 !== "消防区设备" &&
          !isSpaceTheme(p.name, p.en) &&
          !colorScanInFlight.current.has(p.id) &&
          !colorScannedThisRun.current.has(p.id),
      )
      .slice(0, slots)
      .forEach((p) => {
        colorScannedThisRun.current.add(p.id);
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
  }, [products, rescanAllColours]);
  const currency: "CNY" | "USD" = priceMode === "usd" ? "USD" : "CNY";
  const majorProducts = productViews.filter((p) =>
    navigationMajorMembers(activeMajor).includes(p.majorCategory),
  );
  const hasGlobalQuery = query.trim().length > 0;
  const isLifestyleMajor = activeMajor === "生活场景 / Lifestyle Scene";
  const isSeniorCatalog = activeMajor === "大童类 / Older Children";
  const isRetailCatalog = activeMajor === "零售（游玩必备） / Retail";
  const isKitchenView =
    isLifestyleMajor && category === "厨房专区";
  const kitchenProducts = productViews.filter(
    (p) =>
      p.majorCategory === "生活场景 / Lifestyle Scene" &&
      /厨房/.test(p.category2),
  );
  const kitchenMainProducts = kitchenProducts.filter(
    (p) => p.category1 === "模拟设备",
  );
  const kitchenAddonProducts = kitchenProducts.filter(
    (p) => p.category1 === "配套产品",
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
  const hospitalToyNavigationActive =
    selectedCategoryKey === "toys:医院区" && navigationGroup === "toys";
  const hospitalToyCategories = category3Filter
    ? hospitalToyNavigationGroups[
        category3Filter as keyof typeof hospitalToyNavigationGroups
      ]
    : undefined;
  const visible = [...(
    hasGlobalQuery
      ? productViews
      : isKitchenView
      ? kitchenMode === "main"
        ? kitchenMainProducts
        : kitchenMode === "addons"
          ? kitchenAddonProducts
          : []
      : majorProducts
  )]
    .filter(
    (p) =>
      (hasGlobalQuery || !isSeniorCatalog || !selectedCategoryKey.startsWith("senior:") || p.category1 === selectedCategoryKey.slice(7)) &&
      (hasGlobalQuery || category === "全部产品" ||
        (hospitalToyNavigationActive
          ? (hospitalToyCategories
              ? hospitalToyCategories.includes(p.category2)
              : hospitalToySourceCategories.has(p.category2))
          : navigationGroup === "simulation" || navigationGroup === "toys"
            ? groupedNavigationArea(p.category2, navigationGroup) === category
            : p.category2 === category)) &&
      (hasGlobalQuery || hospitalToyNavigationActive || !category3Filter || p.category3 === category3Filter) &&
      (hasGlobalQuery || navigationGroup === "all" ||
        (navigationGroup === "simulation" &&
          (p.category1 === "模拟设备" ||
            (p.category1 === "配套产品" && !isToy(p)))) ||
        (navigationGroup === "toys" && isToy(p))) &&
      (!hasGlobalQuery ||
        `${p.sku}${p.name}${p.en}${p.majorCategory}${majorCategoryDisplayName(p.majorCategory)}${p.category1}${p.category2}${p.category3}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())) &&
      (colorFilter === "全部颜色" || p.colorTag === colorFilter) &&
      (!screenOnly || p.hasScreen) &&
      (!recommendedOnly || p.isRecommended),
    )
    .sort(
      (a, b) =>
        Number(isPairedItem(a)) - Number(isPairedItem(b)),
    );
  const grouped = Object.entries(
    visible.reduce<Record<string, Product[]>>((a, p) => {
      const navigationArea = groupedNavigationArea(p.category2, navigationGroup);
      const groupName = hospitalToyNavigationActive
        ? category3Filter ||
          (hospitalToyNavigationGroups["常规医院"].includes(p.category2)
            ? "常规医院"
            : "未来医院")
        : navigationGroup === "toys" && navigationArea === "种植区"
          ? navigationArea
        : isRetailCatalog
          ? retailTypeDisplayName(p.category2)
          : p.category2;
      (a[groupName] ||= []).push(p);
      return a;
    }, {}),
  ).sort(([leftArea], [rightArea]) =>
    navigationGroup === "simulation" || navigationGroup === "toys"
      ? groupedAreaDisplayPriority(leftArea, category, navigationGroup) -
        groupedAreaDisplayPriority(rightArea, category, navigationGroup)
      : 0,
  );
  const catalogTitle =
    query
      ? `“${query}” 的结果`
      : category === "全部产品" && navigationGroup === "simulation"
        ? "主设备"
      : category === "全部产品" && navigationGroup === "toys"
          ? "配套玩具"
          : category3Filter
            ? `${category} · ${category3Filter}`
            : isRetailCatalog
              ? retailTypeDisplayName(category)
              : category;
  const quoteProducts = [
    ...new Map(
      [...products, ...importedProducts, ...restoredQuoteProducts].map((product) => [
        product.id,
        product,
      ]),
    ).values(),
  ];
  const reviseProduct = (product: Product, field: string, before: string, after: string, status: QuoteRevision["status"] = "modified") => {
    setRestoredQuoteProducts(current => {
      const latest = current.find(item => item.id === product.id) || product;
      const revision: QuoteRevision = {status: status === "modified" && latest.revision?.status === "added" ? "added" : status, changes: [...(latest.revision?.changes || []), {field, before, after, at: new Date().toISOString()}]};
      return [...current.filter(item => item.id !== product.id), {...latest, revision}];
    });
  };
  const setRevisionStatus = (product: Product, status: QuoteRevision["status"]) => reviseProduct(product, "状态", product.revision ? revisionLabels[product.revision.status] : "原表项目", revisionLabels[status], status);
  const billableQuantity = (product: Product, quantity: number) => excludedFromQuote(product) ? 0 : quantity;
  const cartItems = quoteProducts
    .filter((p) => Object.hasOwn(cart, p.id))
    .map((p) => ({ ...p, qty: cart[p.id] }))
    .sort(
      (a, b) =>
        (a.importSourceRow !== undefined && b.importSourceRow !== undefined
          ? a.importSourceRow - b.importSourceRow
          : Number(isPairedItem(a)) - Number(isPairedItem(b)) ||
            a.sku.localeCompare(b.sku)),
    );
  // Imported zero-quantity rows stay visible to preserve the source form.
  const quoteCartItems = cartItems.filter((item) => item.qty > 0 || item.importSourceRow !== undefined);
  const requestPriceModeChange = (nextPriceMode: PriceMode) => setPriceMode(nextPriceMode);
  const displayPrice = (p: Product) => {
    if (priceMode === "usd") return p.usd;
    if (priceMode === "factory")
      return isToy(p) ? p.price : p.factory;
    return p.price;
  };
  const displayPriceLabel = (p: Product) =>
    priceMode === "factory"
      ? isToy(p)
        ? "连锁品牌价（小玩具）"
        : "出厂价"
      : priceMode === "vip"
        ? "连锁品牌价"
        : "美金价格";
  const importCurrency = quoteImportPriceMode === "usd" ? "USD" : "CNY";
  const importUnitPrice = (product: Product) =>
    quoteImportPriceMode === "factory"
      ? isToy(product)
        ? product.price
        : product.factory
      : quoteImportPriceMode === "vip"
      ? product.price
      : quoteImportPriceMode === "usd"
        ? product.usd
        : null;
  const formatImportPrice = (price: number | null) => {
    if (price === null || price === undefined) return "待维护";
    return importCurrency === "USD"
      ? `USD $${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `CNY ¥${price.toLocaleString("zh-CN")}`;
  };
  const subtotal = quoteCartItems.reduce(
    (n, p) => n + (displayPrice(p) || 0) * billableQuantity(p, p.qty),
    0,
  );
  const cartHierarchyItems: Array<{
    product: (typeof cartItems)[number];
    quantity: number;
    area: string;
    parentId?: string;
  }> = [];
  const cartItemById = new Map(quoteCartItems.map((item) => [item.id, item]));
  const allocatedChildQuantities = new Map<string, number>();
  const pairedChildIds = new Set<string>();
  const pairedParentIds = new Set(
    Object.entries(cartPairings)
      .filter(
        ([parentId, children]) =>
          cartItemById.has(parentId) &&
          Object.values(children).some((quantity) => quantity > 0),
      )
      .map(([parentId]) => parentId),
  );
  quoteCartItems
    .filter((item) => pairedParentIds.has(item.id))
    .forEach((parent) => {
      cartHierarchyItems.push({
        product: parent,
        quantity: parent.qty,
        area: quoteArea(parent),
      });
      Object.entries(cartPairings[parent.id] || {}).forEach(
        ([childId, configuredQuantity]) => {
          const child = cartItemById.get(childId);
          if (!child) return;
          pairedChildIds.add(childId);
          const allocated = allocatedChildQuantities.get(childId) || 0;
          const quantity = Math.min(
            Math.max(0, configuredQuantity),
            Math.max(0, child.qty - allocated),
          );
          allocatedChildQuantities.set(childId, allocated + quantity);
          cartHierarchyItems.push({
            product: child,
            quantity,
            area: quoteArea(parent),
            parentId: parent.id,
          });
        },
      );
    });
  quoteCartItems
    .filter((item) => !pairedParentIds.has(item.id))
    .forEach((item) => {
      const quantity = item.qty - (allocatedChildQuantities.get(item.id) || 0);
      if (quantity === 0 && pairedChildIds.has(item.id)) return;
      if (quantity < 0) return;
      cartHierarchyItems.push({
        product: item,
        quantity,
        area: quoteArea(item),
      });
    });
  const quoteGroups = Object.entries(
    cartHierarchyItems.reduce<Record<string, typeof cartHierarchyItems>>(
      (a, item) => {
        (a[`${item.area}\u001f${item.product.importSection ?? ""}`] ||= []).push(item);
        return a;
      },
      {},
    ),
  )
    .map(([, items]) => [items[0].area, [...items].sort(compareQuotationItems)] as const)
    .sort(([left, leftItems], [right, rightItems]) => {
      const leftRow = leftItems[0]?.product.importSourceRow;
      const rightRow = rightItems[0]?.product.importSourceRow;
      if (leftRow !== undefined && rightRow !== undefined) return leftRow - rightRow;
      const otherArea = "其他产品 / Other Products";
      if (left === otherArea || right === otherArea)
        return Number(left === otherArea) - Number(right === otherArea);
      const leftIndex = importedAreaOrder.indexOf(left);
      const rightIndex = importedAreaOrder.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) {
        if (leftIndex < 0) return 1;
        if (rightIndex < 0) return -1;
        return leftIndex - rightIndex;
      }
      return 0;
    });
  const quoteItemsInOrder = quoteGroups.flatMap(([, items]) => items);
  const importedProductIds = new Set(importedProducts.map((product) => product.id));
  const importedPairingItems = importedProducts
    .filter((product) => importedProductIds.has(product.id) && (cart[product.id] || 0) > 0)
    .map((product) => ({ product, quantity: cart[product.id] || 0 }));
  const importedProductAssociations = new Map(
    importedPairingItems.map(({ product }) => {
      const catalogProductId =
        product.catalogProductId ||
        products.find((candidate) => candidate.sku === product.sku)?.id ||
        product.id;
      const quantities = new Map<string, number>();
      relations
        .filter((relation) => relation.productId === catalogProductId)
        .forEach((relation) =>
          quantities.set(
            relation.relatedProductId,
            Math.max(1, relation.quantity || 1),
          ),
        );
      Object.entries(cartPairings[product.id] || {}).forEach(
        ([relatedProductId, quantity]) => {
          if (quantity > 0) quantities.set(relatedProductId, quantity);
        },
      );
      return [
        product.id,
        [...quantities].flatMap(([relatedProductId, quantity]) => {
          const relatedProduct =
            products.find((candidate) => candidate.id === relatedProductId) ||
            importedProducts.find((candidate) => candidate.id === relatedProductId);
          return relatedProduct ? [{ product: relatedProduct, quantity }] : [];
        }),
      ] as const;
    }),
  );
  const quoteVisibleGroups =
    quoteActiveTab === "summary"
      ? []
      : quoteActiveTab === "all"
        ? quoteGroups
        : quoteGroups.filter(([area]) => area === quoteActiveTab);
  const quoteAreaSubtotal = (
    items: typeof quoteItemsInOrder,
  ) =>
    items.reduce(
      (total, item) =>
        total + billableQuantity(item.product, item.quantity) * (displayPrice(item.product) || 0),
      0,
    );
  const toggleQuoteArea = (area: string) => {
    setQuoteExpandedAreas((current) => {
      const next = new Set(current);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };
  const { preTax, tax, totalWithTax } = quotationTotals(subtotal, currency, fees, includeTax, showDesignDeduction);
  const openPairingSelection = (
    source: Product,
    mode: PairingSuggestion["mode"],
  ) => {
    const id = source.id;
    const catalogSource = source.catalogProductId
      ? products.find((candidate) => candidate.id === source.catalogProductId)
      : products.find((candidate) => candidate.id === source.id || candidate.sku === source.sku);
    const sourceArea = pairedArea(catalogSource?.category2 || source.category2, source.name);
    const sourceIsFuture = isFutureArea(sourceArea);
    const pairingCandidates = productViews;
    const matchesSourceArea = (product: Product) =>
      pairingBaseArea(pairedArea(product.category2, product.name)) ===
      pairingBaseArea(sourceArea);
    const isCompatiblePairingItem = (product: Product) =>
      (mode === "cart" ? isToy(product) : isPairedItem(product)) &&
      matchesSourceArea(product) &&
      (!sourceIsFuture || !isToy(product) || isFutureArea(product.category2));
    const existingPairings = cartPairings[id] || {};
    const relationByProductId = new Map(
      relations
        .filter((relation) => relation.productId === (catalogSource?.id || id))
        .map((relation) => [relation.relatedProductId, relation]),
    );
    const pairedProductIds = new Set([
      ...relationByProductId.keys(),
      ...(mode === "cart" ? Object.keys(existingPairings) : []),
    ]);
    const pairedItems = [...pairedProductIds]
      .flatMap((relatedProductId) => {
        const relation = relationByProductId.get(relatedProductId);
        const product = pairingCandidates.find(
          (candidate) => candidate.id === relatedProductId,
        );
        return product && isCompatiblePairingItem(product)
          ? [{
              product,
              quantity: mode === "cart"
                ? existingPairings[product.id] || Math.max(1, relation?.quantity || 1)
                : Math.max(1, relation?.quantity || 1),
              isBound: true,
            }]
          : [];
    });
    const pairedIds = new Set(pairedItems.map(({ product }) => product.id));
    const areaOptions = sourceArea
      ? pairingCandidates
          .filter(
            (product) =>
              isCompatiblePairingItem(product) &&
              !pairedIds.has(product.id) &&
              product.id !== source.id,
          )
          .filter(
            (product, index, all) =>
              all.findIndex((candidate) => candidate.id === product.id) === index,
          )
          .map((product) => ({
            product,
            quantity: mode === "cart" ? existingPairings[product.id] || 0 : 0,
            isBound: false,
          }))
      : [];
    const relatedItems = [...pairedItems, ...areaOptions];
    setCollapsedHospitalPairingGroups(new Set());
    setPairingBatchQuantity("");
    setPairingSuggestion({ source, mode, relatedItems });
  };
  const add = (source: Product) => {
    const id = source.id;
    if (!cart[source.id]) setRevisionStatus(source, "added");
    else reviseProduct(source, "数量", String(cart[source.id]), String(cart[source.id] + 1));
    if (isPairedItem(source)) {
      setCart((x) => ({ ...x, [id]: (x[id] || 0) + 1 }));
      return;
    }
    openPairingSelection(source, "catalog");
  };
  const clearQuotation = () => {
    setCart({});
    setQuoteQuantityDrafts({});
    setCartPairings({});
    setSelectedCartItemKeys(new Set());
    setImportedProducts([]);
    setImportedAreaOrder([]);
    setToyMatchingDraftId("");
    setSelectedImportedProductId(null);
    setExpandedImportedRelations(new Set());
    setImagePreviewProduct(null);
    setImportedQuotePairingOpen(false);
    setRestoredQuoteProducts([]);
    setRecordedQuoteHistoryId("");
    setQuoteHistoryLineageId("");
    quoteImportTemplateRef.current = null;
    setPairingSuggestion(null);
    setPairingRemovalPrompt(null);
  };
  const addSuggestedPairing = () => {
    if (!pairingSuggestion) return;
    const selectedItems = pairingSuggestion.relatedItems.filter(
      ({ quantity }) => quantity > 0,
    );
    if (!cart[pairingSuggestion.source.id]) setRevisionStatus(pairingSuggestion.source, "added");
    selectedItems.forEach(({product}) => { if (!cart[product.id]) setRevisionStatus(product, "added"); });
    setCart((current) => {
      const next = {
        ...current,
        [pairingSuggestion.source.id]: (current[pairingSuggestion.source.id] || 0) + 1,
      };
      selectedItems.forEach(({ product, quantity }) => {
        next[product.id] = (next[product.id] || 0) + quantity;
      });
      return next;
    });
    if (selectedItems.length) {
      setCartPairings((current) => {
        const next = { ...current };
        const children = { ...(next[pairingSuggestion.source.id] || {}) };
        selectedItems.forEach(({ product, quantity }) => {
          children[product.id] = (children[product.id] || 0) + quantity;
        });
        next[pairingSuggestion.source.id] = children;
        return next;
      });
    }
    setPairingSuggestion(null);
  };
  const addSourceOnly = () => {
    if (!pairingSuggestion) return;
    const sourceId = pairingSuggestion.source.id;
    if (!cart[sourceId]) setRevisionStatus(pairingSuggestion.source, "added");
    else reviseProduct(pairingSuggestion.source, "数量", String(cart[sourceId]), String(cart[sourceId] + 1));
    setCart((current) => ({
      ...current,
      [sourceId]: (current[sourceId] || 0) + 1,
    }));
    setPairingSuggestion(null);
  };
  const saveCartToyPairing = () => {
    if (!pairingSuggestion || pairingSuggestion.mode !== "cart") return;
    const sourceId = pairingSuggestion.source.id;
    const previousPairings = cartPairings[sourceId] || {};
    const selectedToys = pairingSuggestion.relatedItems.filter(
      ({ quantity }) => quantity > 0,
    );
    const toyIds = new Set(
      [
        ...Object.keys(previousPairings),
        ...pairingSuggestion.relatedItems.map(({ product }) => product.id),
      ],
    );
    const nextToyQuantities = new Map(
      pairingSuggestion.relatedItems.map(({ product, quantity }) => [product.id, quantity]),
    );
    setCart((current) => {
      const next = { ...current };
      toyIds.forEach((productId) => {
        const change = (nextToyQuantities.get(productId) || 0) - (previousPairings[productId] || 0);
        if (change)
          next[productId] = Math.max(0, (next[productId] || 0) + change);
      });
      return next;
    });
    setCartPairings((current) => {
      const children = Object.fromEntries(
        Object.entries(current[sourceId] || {}).filter(
          ([childId]) => !toyIds.has(childId),
        ),
      );
      selectedToys.forEach(({ product, quantity }) => {
        children[product.id] = quantity;
      });
      const next = { ...current };
      if (Object.keys(children).length) next[sourceId] = children;
      else delete next[sourceId];
      return next;
    });
    setCartOpen(false);
    setImportedQuotePairingOpen(true);
    setPairingSuggestion(null);
  };
  const setSuggestedPairingQuantity = (id: string, quantity: number) => {
    setPairingSuggestion((current) =>
      current
        ? {
            ...current,
            relatedItems: current.relatedItems.map((item) =>
              item.product.id === id
                ? { ...item, quantity: Math.max(0, Math.floor(quantity || 0)) }
                : item,
            ),
          }
        : null,
    );
  };
  const setOptionalPairingSelection = (id: string, selected: boolean) => {
    setPairingSuggestion((current) =>
      current
        ? {
            ...current,
            relatedItems: current.relatedItems.map((item) =>
              item.product.id === id
                ? { ...item, quantity: selected ? Math.max(1, item.quantity) : 0 }
                : item,
            ),
          }
        : null,
    );
  };
  const setAllOptionalPairingSelections = (selected: boolean) => {
    setPairingSuggestion((current) =>
      current
        ? {
            ...current,
            relatedItems: current.relatedItems.map((item) =>
              item.isBound
                ? item
                : { ...item, quantity: selected ? Math.max(1, item.quantity) : 0 },
            ),
          }
        : null,
    );
  };
  const applyOptionalPairingBatchQuantity = () => {
    if (!/^[1-9]\d*$/.test(pairingBatchQuantity)) return;
    const quantity = Number(pairingBatchQuantity);
    setPairingSuggestion((current) =>
      current
        ? {
            ...current,
            relatedItems: current.relatedItems.map((item) =>
              !item.isBound && item.quantity > 0 ? { ...item, quantity } : item,
            ),
          }
        : null,
    );
  };
  const changePairedCartQuantity = (
    parentId: string,
    childId: string,
    change: number,
  ) => {
    const quantity = cartPairings[parentId]?.[childId] || 0;
    if (change < 0 && quantity <= 0) return;
    setCartPairings((current) => {
      const children = { ...(current[parentId] || {}) };
      const nextQuantity = Math.max(0, (children[childId] || 0) + change);
      if (nextQuantity) children[childId] = nextQuantity;
      else delete children[childId];
      const next = { ...current };
      if (Object.keys(children).length) next[parentId] = children;
      else delete next[parentId];
      return next;
    });
    setCart((current) => ({
      ...current,
      [childId]: Math.max(0, (current[childId] || 0) + change),
    }));
  };
  const setQuoteItemQuantity = (
    productId: string,
    nextQuantity: number,
    parentId?: string,
  ) => {
    const quantity = Math.max(0, quoteProducts.find(p => p.id === productId)?.quoteCosting ? (nextQuantity || 0) : Math.floor(nextQuantity || 0));
    const product = quoteProducts.find(item => item.id === productId);
    const previous = parentId ? cartPairings[parentId]?.[productId] || 0 : cart[productId] || 0;
    if (product && previous !== quantity) {
      if (!quantity) { setRevisionStatus(product, "deleted"); return; }
      reviseProduct(product, "数量", String(previous), String(quantity));
    }
    if (!parentId) {
      setCart((current) => ({ ...current, [productId]: quantity }));
      return;
    }
    const currentQuantity = cartPairings[parentId]?.[productId] || 0;
    const change = quantity - currentQuantity;
    if (!change) return;
    setCartPairings((current) => ({
      ...current,
      [parentId]: { ...(current[parentId] || {}), [productId]: quantity },
    }));
    setCart((current) => ({
      ...current,
      [productId]: Math.max(0, (current[productId] || 0) + change),
    }));
  };
  const setImportedAssociationQuantity = (
    parentId: string,
    childId: string,
    quantity: number,
  ) => {
    const nextQuantity = Math.max(1, Math.floor(quantity || 1));
    const currentQuantity = cartPairings[parentId]?.[childId] || 0;
    const change = nextQuantity - currentQuantity;
    setCartPairings((current) => ({
      ...current,
      [parentId]: { ...(current[parentId] || {}), [childId]: nextQuantity },
    }));
    if (change)
      setCart((current) => ({
        ...current,
        [childId]: Math.max(0, (current[childId] || 0) + change),
      }));
  };
  const quoteQuantityKey = (productId: string, parentId?: string) =>
    `${parentId || "root"}:${productId}`;
  const removeCartItems = (itemKeys: Set<string>) => {
    const selected = cartHierarchyItems.filter(item => itemKeys.has(quoteQuantityKey(item.product.id, item.parentId)));
    const parents = new Set(selected.filter(item => !item.parentId).map(item => item.product.id));
    cartHierarchyItems.filter(item => selected.includes(item) || item.parentId && parents.has(item.parentId)).forEach(item => setRevisionStatus(item.product, "deleted"));
    setSelectedCartItemKeys(new Set());
  };
  const toggleCartItemSelection = (itemKey: string, selected: boolean) => {
    setSelectedCartItemKeys((current) => {
      const next = new Set(current);
      if (selected) next.add(itemKey);
      else next.delete(itemKey);
      return next;
    });
  };
  const renderQuoteItemRow = (
    item: (typeof cartHierarchyItems)[number],
    serial: number,
  ) => {
    const { product: p, quantity, parentId } = item;
    const cnyPrice = priceMode === "usd" ? p.price : displayPrice(p);
    const usdPrice = p.usd ?? null;
    const cost = canViewQuoteCost ? p.cost : null;
    const quantityKey = quoteQuantityKey(p.id, parentId);
    return (
      <tr
        className={`revision-${p.revision?.status || "none"} ${parentId ? "quoteChildRow" : "quoteParentRow"}${quantity === 0 ? " quoteZeroQuantity" : ""}`}
        key={`${parentId || "root"}-${p.id}`}
      >
        <td>{p.importSequence ?? serial}</td>
        <td className="quoteSku">
          <label className="quoteSkuSelect">
            <input
              aria-label={`选择 ${p.sku || p.name}`}
              checked={selectedCartItemKeys.has(quantityKey)}
              onChange={(event) => toggleCartItemSelection(quantityKey, event.target.checked)}
              type="checkbox"
            />
            <span>{p.sku || "—"}</span>
          </label>
        </td>
        <td className={p.revision?.status === "modified" && p.importBlueColumns?.includes(2) ? "revisionModifiedCell" : ""}>
          {parentId && <span className="quoteRelationLabel">关联产品 / Paired item</span>}
          <b>{p.name}</b>
          <small className={needsEnglishTranslation(p) ? "missingEnglish" : ""}>
            {englishProductName(p)}
          </small>
        </td>
        <td className={p.revision?.status === "modified" && p.importBlueColumns?.includes(3) ? "revisionModifiedCell" : ""}>
          <div className="quoteImage">
            <Visual p={p} mini />
          </div>
        </td>
        <td className={p.revision?.status === "modified" && p.importBlueColumns?.includes(4) ? "revisionModifiedCell" : ""}>{p.brand || "YIFUN"}</td>
        <td className={p.revision?.changes.some(change => change.field === "规格/尺寸") ? "revisionModifiedCell" : ""}><textarea rows={Math.max(2, (p.spec || "").split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 20)), 0))} aria-label={`${p.sku || p.name} 规格/尺寸`} className="quoteRevisionSpec" key={`${p.id}:${p.spec}`} defaultValue={p.spec || ""} onBlur={async event => {
          const field = event.target;
          let value = field.value;
          if (value === (p.spec || "")) return;
          try {value = (await bilingualQuoteProducts([{...p, spec: value}]))[0].spec || "";}
          catch (error) {field.value = p.spec || ""; window.alert(error instanceof Error ? error.message : "规格翻译未完成，请重试"); return;}
          reviseProduct(p, "规格/尺寸", p.spec || "", value);
          setRestoredQuoteProducts(current => current.map(item => item.id === p.id ? {...item, spec: value} : item));
        }} /></td>
        <td>
          <QuoteBilingual {...unitLabel(p.unit)} />
        </td>
        <td className={p.revision?.changes.some(change => change.field === "数量") ? "revisionModifiedCell" : ""}>
          <div className="quoteQuantityEditor">
            <input
              aria-label={`${p.sku || p.name} 数量`}
              className="quoteQtyInput"
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={quoteQuantityDrafts[quantityKey] ?? (p.importSourceQuantity === null && quantity === 1 ? "" : String(quantity))}
              onChange={(event) => {
                const value = event.target.value;
                if (!/^\d*$/.test(value)) return;
                setQuoteQuantityDrafts((current) => ({
                  ...current,
                  [quantityKey]: value,
                }));
                if (value !== "")
                  setQuoteItemQuantity(p.id, Number(value), parentId);
              }}
              onBlur={() => {
                const value = quoteQuantityDrafts[quantityKey];
                if (value === undefined) return;
                if (value !== "")
                  setQuoteItemQuantity(p.id, Number(value), parentId);
                setQuoteQuantityDrafts((current) => {
                  const next = { ...current };
                  delete next[quantityKey];
                  return next;
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <button
              aria-label={`删除 ${p.sku || p.name}`}
              className="quoteDeleteButton"
              onClick={() => removeCartItems(new Set([quantityKey]))}
              type="button"
            >
              删除
            </button>
          </div>
        </td>
        <td>{canViewQuoteCost ? money(cost, "CNY", 2) : "—"}</td>
        <td>{canViewQuoteCost ? money(cost == null ? null : cost * billableQuantity(p, quantity), "CNY", 2) : "—"}</td>
        <td>{money(cnyPrice, "CNY", 2)}</td>
        <td>{money(cnyPrice == null ? null : cnyPrice * billableQuantity(p, quantity), "CNY", 2)}</td>
        <td>{money(usdPrice, "USD", 2)}</td>
        <td>{money(usdPrice == null ? null : usdPrice * billableQuantity(p, quantity), "USD", 2)}</td>
        <td></td>
        <td>
          <QuoteBilingual zh={splitBilingual(p.note || "").zh || "—"} en={englishRemark(p.note)} />
          <select className="quoteRevisionStatus" aria-label={`${p.sku || p.name} 修订状态`} value={p.revision?.status || ""} onChange={event => {if(event.target.value) setRevisionStatus(p, event.target.value as QuoteRevision["status"]);}}>
            <option value="" disabled>修订状态</option>{Object.entries(revisionLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {p.revision && <details className="quoteRevisionLog"><summary>{revisionLabels[p.revision.status]} · 修改记录</summary>{p.revision.changes.map((change,index) => <div key={index}>{change.field}：{change.before || "空白"} → {change.after || "空白"}<small>{new Date(change.at).toLocaleString("zh-CN")}</small></div>)}</details>}
        </td>
        <td className="sourceFormNote">{p.material || "—"}</td>
        <td>{p.volume || "—"}</td>
      </tr>
    );
  };
  const renderPrintQuoteItem = (
    item: (typeof cartHierarchyItems)[number],
    serial: number,
  ) => {
    const { product: p, quantity } = item;
    const unitPrice = displayPrice(p);
    const amount = unitPrice === null ? null : unitPrice * quantity;
    const englishName = needsEnglishTranslation(p) ? "" : englishProductName(p);
    const colour = ["待重新识别", "未识别", "无主图"].includes(p.colorTag)
      ? { zh: "", en: "" }
      : colourLabel(p.colorTag);
    return (
      <div className="quotePrintItem" key={`print-${item.parentId || "root"}-${p.id}`}>
        <span className="quotePrintNo">{serial}</span>
        <div className="quotePrintImage">
          <Visual p={p} mini eager />
        </div>
        <PrintBilingual zh={p.name} en={englishName} />
        <span>{printValue(p.brand || "YIFUN")}</span>
        <span>{printValue(p.spec)}</span>
        <PrintBilingual {...unitLabel(p.unit)} />
        <strong>{quantity}</strong>
        <strong className="quotePrintAmount">{money(unitPrice, currency)}</strong>
        <strong className="quotePrintAmount">{money(amount, currency)}</strong>
        <PrintBilingual {...colour} />
        <span>{printValue(p.volume)}</span>
        <PrintBilingual zh={p.note || "\u00a0"} en={englishRemark(p.note)} />
      </div>
    );
  };
  const remove = (id: string) => {
    const product = quoteProducts.find((candidate) => candidate.id === id);
    const quantity = cart[id] || 0;
    if (!product || quantity <= 1) {
      const relatedItems = product
        ? Object.entries(cartPairings[id] || {}).flatMap(
            ([relatedProductId, pairedQuantity]) => {
              const relatedProduct = products.find(
                (candidate) => candidate.id === relatedProductId,
              );
              const quantity = Math.min(
                pairedQuantity,
                cart[relatedProductId] || 0,
              );
              return relatedProduct && quantity
                ? [{ product: relatedProduct, quantity }]
                : [];
            },
          )
        : [];
      if (product && !isPairedItem(product) && relatedItems.length) {
        setPairingRemovalPrompt({ device: product, relatedItems });
        return;
      }
    }
    if (product && isPairedItem(product)) {
      const pairedQuantity = Object.values(cartPairings).reduce(
        (total, children) => total + (children[id] || 0),
        0,
      );
      if (pairedQuantity >= quantity) {
        const parentId = Object.keys(cartPairings).find(
          (candidate) => (cartPairings[candidate]?.[id] || 0) > 0,
        );
        if (parentId) changePairedCartQuantity(parentId, id, -1);
        return;
      }
    }
    setCart((current) => ({
      ...current,
      [id]: Math.max(0, quantity - 1),
    }));
  };
  const removePairedDevice = (removeRelatedToys: boolean) => {
    if (!pairingRemovalPrompt) return;
    setCart((current) => {
      const next = { ...current, [pairingRemovalPrompt.device.id]: 0 };
      if (removeRelatedToys) {
        pairingRemovalPrompt.relatedItems.forEach(({ product, quantity }) => {
          next[product.id] = Math.max(0, (next[product.id] || 0) - quantity);
        });
      }
      return next;
    });
    setCartPairings((current) => {
      const next = { ...current };
      delete next[pairingRemovalPrompt.device.id];
      return next;
    });
    setPairingRemovalPrompt(null);
  };
  const uploadQuoteTemplate = async (file: File): Promise<{ id: string }> => {
    if (file.size > 200 * 1024 * 1024) throw new Error("转换后的报价模板不能超过 200MB");
    const readResult = async (response: Response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "模板上传失败，请重新导入");
      return result;
    };
    if (file.size <= 8 * 1024 * 1024) {
      const form = new FormData();
      form.set("file", file);
      const result = await readResult(await fetch("/api/quote-template", { method: "POST", body: form }));
      if (!result.id) throw new Error("模板保存失败，请重新导入");
      return result;
    }
    const upload = await readResult(await fetch("/api/quote-template/upload", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size }),
    }));
    const endpoint = `/api/quote-template/upload?id=${encodeURIComponent(upload.id)}`;
    try {
      const parts: Array<{ partNumber: number; etag: string }> = [];
      for (let offset = 0; offset < file.size; offset += upload.partSize) {
        const part = parts.length + 1;
        parts.push(await readResult(await fetch(`${endpoint}&part=${part}`, { method: "PUT", body: file.slice(offset, offset + upload.partSize) })));
      }
      return await readResult(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts }) }));
    } catch (error) {
      await fetch(endpoint, { method: "DELETE" }).catch(() => {});
      throw error;
    }
  };
  const translateQuoteWorkbook = async (source: ArrayBuffer, signal?: AbortSignal, onProgress?: (completed: number, total: number, failed: number) => void): Promise<ArrayBuffer> => {
    const book = XLSX.read(source, {type: "array", cellStyles: true});
    const files = unzipSync(new Uint8Array(source));
    const changes: Array<{path: string; ref: string; text: string; english?: string}> = [];
    book.SheetNames.forEach((name, index) => {
      if (name === "修改记录") return;
      const sheet = book.Sheets[name];
      const path = `xl/worksheets/sheet${index + 1}.xml`;
      if (!files[path]) return;
      const headerRow = Object.entries(sheet).find(([ref, cell]) => !ref.startsWith("!") && /款号|item\s*number|^sku$/i.test(String(cell.v || "")))?.[0].match(/\d+$/)?.[0];
      Object.entries(sheet).forEach(([ref, cell]) => {
        if (ref.startsWith("!") || cell.f || cell.t !== "s" || (ref.match(/\d+$/)?.[0] === headerRow && !/材质.*工艺|^工艺做法$/.test(String(cell.v || "")))) return;
        const text = String(cell.v || "").trim();
        const hasEnglishLine = text.split(/\n+/).some(line => /[A-Za-z]{2,}/.test(line) && !/[\u4e00-\u9fff]/.test(line));
        const hasEnglishSuffix = /\/[ \t]*[A-Za-z][^\u4e00-\u9fff]*$/.test(text);
        if (!/[\u4e00-\u9fff]/.test(text) || hasEnglishLine || hasEnglishSuffix || /[A-Za-z]{2,}[ \t]+[A-Za-z]{2,}/.test(text)) return;
        const row = ref.match(/\d+$/)?.[0];
        const sku = String(sheet[`B${row}`]?.v || "").trim().toUpperCase();
        const catalog = ref.startsWith("C") ? products.find(product => product.sku.toUpperCase() === sku) : undefined;
        const english = catalog?.en && !/[\u4e00-\u9fff]/.test(catalog.en) ? catalog.en : undefined;
        changes.push({path, ref, text, english});
      });
    });
    if (!changes.length) return source;
    const texts = [...new Set(changes.filter(change => !change.english).map(change => change.text))];
    const translated = new Map<string, string>();
    let completed = 0;
    let failed = 0;
    onProgress?.(0, texts.length, 0);
    for (let offset = 0; offset < texts.length; offset += 24) {
      const batch = texts.slice(offset, offset + 24);
      try {
        const response = await fetch("/api/quote-translate", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({texts: batch}), signal});
        const result = await response.json();
        if (!Array.isArray(result.translations) || result.translations.length !== batch.length) throw new Error(result.error || "自动翻译未完成，请重新导入");
        batch.forEach((text, index) => {
          const english = result.translations[index];
          if (typeof english === "string" && english.trim() && /[A-Za-z]/.test(english) && !/[\u4e00-\u9fff]/.test(english)) translated.set(text, english.trim());
        });
        const missing = batch.filter(text => !translated.has(text)).length;
        if (missing && !onProgress) throw new Error(result.error || "自动翻译未完成，请重新导入");
        failed += missing;
      } catch (error) {
        if (!onProgress) throw error;
        failed += batch.filter(text => !translated.has(text)).length;
      }
      completed += batch.length;
      if (signal?.aborted) {
        failed += texts.length - completed;
        completed = texts.length;
        onProgress?.(completed, texts.length, failed);
        break;
      }
      onProgress?.(completed, texts.length, failed);
    }
    const sheets = new Map<string, string>();
    const heights = new Map<string, Map<number, number>>();
    changes.forEach(change => {
      const english = change.english || translated.get(change.text);
      if (!english) {
        if (onProgress) return;
        throw new Error("自动翻译未完成，请重新导入");
      }
      const xml = sheets.get(change.path) || strFromU8(files[change.path]);
      const bilingual = `${change.text}\n${english}`;
      sheets.set(change.path, updateTemplateCell(xml, change.ref, bilingual));
      const sheetIndex = Number(change.path.match(/sheet(\d+)/)?.[1]) - 1;
      const sheet = book.Sheets[book.SheetNames[sheetIndex]];
      const position = XLSX.utils.decode_cell(change.ref);
      const merged = sheet["!merges"]?.find(range => range.s.r === position.r && range.s.c === position.c);
      let width = 0;
      for (let column = position.c; column <= (merged?.e.c ?? position.c); column++) width += (sheet["!cols"]?.[column]?.wpx || 80) * .75;
      const capacity = Math.max(4, (width - 8) / 6);
      const lines = bilingual.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil([...line].reduce((length, char) => length + (/[\u4e00-\u9fff]/.test(char) ? 2 : 1), 0) / capacity * 1.15)), 0);
      const rowSpan = (merged?.e.r ?? position.r) - position.r + 1;
      const current = Array.from({length: rowSpan}, (_, index) => sheet["!rows"]?.[position.r + index]?.hpt || 15).reduce((sum, height) => sum + height, 0);
      const required = lines * 17 + 8;
      if (position.c < 18 && required > current) {
        const rows = heights.get(change.path) || new Map<number, number>();
        rows.set(position.r + 1, Math.max(rows.get(position.r + 1) || 0, (sheet["!rows"]?.[position.r]?.hpt || 15) + required - current));
        heights.set(change.path, rows);
      }
    });
    if (!sheets.size) return source;
    sheets.forEach((xml, path) => {
      heights.get(path)?.forEach((height, row) => {
        xml = xml.replace(new RegExp(`<row\\b(?=[^>]*\\br="${row}")[^>]*>`), tag => tag.replace(/\s(?:ht|customHeight)="[^"]*"/g, "").replace(/>$/, ` ht="${Math.ceil(height)}" customHeight="1">`));
      });
      files[path] = strToU8(normalizeTemplateCellOrder(xml));
    });
    return zipSync(files, {level: 6}).buffer as ArrayBuffer;
  };
  const bilingualQuoteProducts = async (items: Product[]): Promise<Product[]> => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["款号 Item Number", "产品名称 Product Name", "规格 Specifications", "单位 Unit", "品牌 Brand", "备注 Notes", "材质 Materials"],
      ...items.map(product => [product.sku, [product.name, needsEnglishTranslation(product) ? "" : englishProductName(product)].filter(Boolean).join("\n"), product.spec, product.unit, product.brand, product.note, product.material]),
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Quote");
    const translated = XLSX.read(await translateQuoteWorkbook(XLSX.write(book, {type: "array", bookType: "xlsx"})), {type: "array"}).Sheets.Quote;
    return items.map((product, index) => {
      const row = index + 2;
      const name = splitBilingual(String(translated[`B${row}`]?.v || ""));
      return {...product, name: name.zh, en: name.en || product.en, spec: String(translated[`C${row}`]?.v || ""), unit: String(translated[`D${row}`]?.v || ""), brand: String(translated[`E${row}`]?.v || ""), note: String(translated[`F${row}`]?.v || ""), material: String(translated[`G${row}`]?.v || "")};
    });
  };
  const readQuoteImport = async (file: File) => {
    setQuoteImporting(true);
    setQuoteImportError("");
    setQuoteImportPreview(null);
    try {
      if (!/\.xlsx?$/i.test(file.name)) throw new Error("请选择 .xls 或 .xlsx 格式的 Excel 文件");
      if (file.size > 200 * 1024 * 1024) throw new Error("导入文件不能超过 200MB");
      const originalSource = await file.arrayBuffer();
      let workbook = XLSX.read(originalSource, { type: "array", cellStyles: true });
      const isLegacyExcel = /\.xls$/i.test(file.name);
      let source: ArrayBuffer = isLegacyExcel
        ? XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true })
        : originalSource;
      const translationController = new AbortController();
      const translationTimeout = setTimeout(() => translationController.abort(), 120000);
      try {
        source = await translateQuoteWorkbook(source, translationController.signal, (completed, total, failed) => {
          setQuoteImportTranslationProgress(total ? `正在翻译英文：${completed} / ${total} 段` : "正在补充产品英文名称…");
          if (completed === total && failed) setQuoteImportError(`有 ${failed} 段英文翻译未完成；已保留这些原文和其余成功翻译，可继续导入。`);
        });
      } catch {
        setQuoteImportError("英文翻译暂未完成，已保留原文，可继续导入；英文可稍后补充。");
      } finally {
        clearTimeout(translationTimeout);
        setQuoteImportTranslationProgress("");
      }
      workbook = XLSX.read(source, {type: "array", cellStyles: true});
      const templateFile = new File([source], file.name.replace(/\.xls$/i, ".xlsx"), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const revisionRecords = workbook.Sheets["修改记录"] ? XLSX.utils.sheet_to_json(workbook.Sheets["修改记录"], {header: 1}) as unknown[][] : [];
      const importedRevisions = new Map<number, QuoteRevision>();
      revisionRecords.slice(1).forEach(row => { try { const revision = JSON.parse(String(row[8] || "")) as QuoteRevision; if (revision.status in revisionLabels && Array.isArray(revision.changes)) importedRevisions.set(Number(row[0]), revision); } catch {} });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("未找到可读取的工作表");
      const worksheetStartRow = XLSX.utils.decode_range(
        worksheet["!ref"] || "A1",
      ).s.r;
      const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
      }) as unknown[][];
      const headerIndex = rows.findIndex((row) =>
        row.some((cell) => /款号|item\s*number|sku|货号/i.test(importCellText(cell))),
      );
      if (headerIndex < 0)
        throw new Error("未找到“款号 / Item Number / SKU”列");
      const header = rows[headerIndex].map(importCellText);
      const skuColumn = findImportColumn(header, /款号|item\s*number|sku|货号/i);
      const nameColumn = findImportColumn(header, /产品名称|product\s*name|名称/i);
      const imageColumn = findImportColumn(header, /图片|image/i);
      const brandColumn = findImportColumn(header, /品牌|brand/i);
      const specificationColumn = findImportColumn(header, /规格|尺寸|specification|dimension/i);
      const unitColumn = findImportColumn(header, /单位|unit/i);
      const quantityColumn = findImportColumn(header, /数量|quantity|qty/i);
      const cnyUnitColumn = findImportColumn(
        header,
        /^(?!.*成本)(?!.*出厂).*单价.*(rmb|cny|人民币)|(rmb|cny|人民币).*(?!成本)(?!出厂).*单价/i,
      );
      const cnyAmountColumn = findImportColumn(header, /合计金额.*(rmb|cny|人民币)|报价.*(rmb|cny|人民币)/i);
      const usdUnitColumn = findImportColumn(header, /美元单价|unit\s*price.*usd|usd.*unit\s*price/i);
      const usdAmountColumn = findImportColumn(header, /美元合计|total.*usd|usd.*total/i);
      const areaSubtotalColumn = findImportColumn(header, /区域小计|subtotal/i);
      const colorColumn = findImportColumn(header, /颜色|colour|color/i);
      const noteColumn = findImportColumn(header, /备注|notes?|remarks?/i);
      const materialColumn = findImportColumn(header, /材质|工艺|material/i);
      const volumeColumn = findImportColumn(header, /体积|volume/i);
      const selectedUnitColumn =
        quoteImportPriceMode === "usd" ? usdUnitColumn : cnyUnitColumn;
      const selectedAmountColumn =
        quoteImportPriceMode === "usd" ? usdAmountColumn : cnyAmountColumn;
      if (quantityColumn < 0 || selectedUnitColumn < 0 || selectedAmountColumn < 0)
        throw new Error(
          `未完整识别“数量、${quoteImportPriceMode === "usd" ? "美元单价、美元合计" : "人民币单价、人民币合计"}”列，请使用原始报价表导入。`,
        );
      const productBySku = new Map(
        products.map((product) => [product.sku.toUpperCase(), product]),
      );
      const importRows: Array<{ product: Product; quantity: number }> = [];
      const sequenceColumn = findImportColumn(header, /序号|^no\.?$/i);
      const matched: Array<{ product: Product; quantity: number }> = [];
      const imported: Array<{ product: Product; quantity: number }> = [];
      const unmatchedSkus = new Set<string>();
      const workbookImages = extractWorkbookImages(source);
      const importedImageUrls = new Map<string, string>();
      await Promise.all(
        [...workbookImages.entries()].map(async ([imageId, image]) => {
          const form = new FormData();
          form.set("file", image, `${imageId}.${image.type === "image/jpeg" ? "jpg" : "png"}`);
          try {
            const response = await fetch("/api/quote-import-image", { method: "POST", body: form });
            const result = response.ok ? await response.json() as { imageUrl?: string } : null;
            if (result?.imageUrl) {
              importedImageUrls.set(imageId, result.imageUrl);
              return;
            }
          } catch {
            // Keep the image available for this import if an upload is interrupted.
          }
          importedImageUrls.set(imageId, URL.createObjectURL(image));
        }),
      );
      let sourceRows = 0;
      let currentArea = "导入项目 / Imported items";
      let currentSection = 0;
      const firstSummaryRow = rows.findIndex((row, index) => index > headerIndex && /包装费|除甲醛|运输费|安装费|小计|税额|总计|合计金额/i.test(importCellText(row[nameColumn])));
      rows.slice(headerIndex + 1).forEach((row, rowOffset) => {
        if (firstSummaryRow >= 0 && headerIndex + rowOffset + 1 >= firstSummaryRow) return;
        const sourceRow = worksheetStartRow + headerIndex + rowOffset + 1;
        // Merged section labels and template instructions are not product rows.
        const section = worksheet["!merges"]?.find(merge => merge.s.r === sourceRow && merge.s.c <= skuColumn && merge.e.c >= nameColumn);
        if (section) {
          const label = importCellText(worksheet[XLSX.utils.encode_cell(section.s)]?.v);
          if (label && section.s.c === skuColumn) {
            currentArea = label;
            currentSection = sourceRow;
          }
          return;
        }
        const skus = importedSkuCodes(row[skuColumn]);
        const rawQuantity = importCellNumber(row[quantityColumn]);
        const nameLines = String(row[nameColumn] ?? "").trim().split(/\n+/);
        const sourceEnglish = nameLines.filter(line => /[A-Za-z]/.test(line) && !/[\u4e00-\u9fff]/.test(line)).join(" ");
        const sourceName = nameLines.filter(line => /[\u4e00-\u9fff]/.test(line)).join("\n") || importCellText(row[nameColumn]);
        const isSummaryRow = /包装费|除甲醛|运输费|安装费|小计|税额|总计|合计金额/i.test(
          sourceName,
        );
        if (isSummaryRow) return;
        if (!skus.length && !sourceName) {
          const areaName = row.map(importCellText).find(Boolean);
          if (
            areaName &&
            /[\u4e00-\u9fffA-Za-z]/.test(areaName) &&
            !/^=DISPIMG\(/i.test(areaName) &&
            !/包装费|除甲醛|运输费|安装费|小计|总计|税额|设计费/i.test(areaName)
          )
            currentArea = areaName;
          return;
        }
        sourceRows += 1;
        if (rawQuantity !== null && rawQuantity < 0) throw new Error("产品数量不能小于 0");
        const quantity = rawQuantity === null ? 1 : rawQuantity;
        const sourceImageId = importCellText(row[imageColumn]).match(/(ID_[A-F0-9]+)/i)?.[1];
        const sourceImageValue = importCellText(row[imageColumn]);
        const importedImage =
          (sourceImageId ? importedImageUrls.get(sourceImageId) : "") ||
          (/^https?:\/\//i.test(sourceImageValue) ? sourceImageValue : "");
        const sourceUnitPrice = (unitColumn: number, amountColumn: number) => {
          const unitPrice = unitColumn >= 0 ? importCellNumber(row[unitColumn]) : null;
          const amount = amountColumn >= 0 ? importCellNumber(row[amountColumn]) : null;
          return unitPrice ?? (amount !== null && rawQuantity ? amount / rawQuantity : null);
        };
        const cnyUnitPrice =
          sourceUnitPrice(cnyUnitColumn, cnyAmountColumn);
        const usdUnitPrice = sourceUnitPrice(usdUnitColumn, usdAmountColumn);
        const createImportedProduct = (sku: string, catalog?: Product): Product => ({
          id: `imported-${headerIndex + rowOffset + 1}-${sku || "no-sku"}`,
          sku,
          name: sourceName || catalog?.name || sku || "未命名导入项目",
          en: sourceEnglish || catalog?.en || "",
          category: catalog?.category || currentArea,
          family: catalog?.family || ("大型设备" as const),
          price: catalog?.price ?? cnyUnitPrice,
          factory: catalog?.factory ?? (quoteImportPriceMode === "factory" ? cnyUnitPrice : null),
          priceNote: "来自导入报价表",
          usd: catalog?.usd ?? usdUnitPrice,
          unit: unitColumn >= 0 ? String(row[unitColumn] ?? "").trim() : catalog?.unit || "",
          spec: specificationColumn >= 0 ? String(row[specificationColumn] ?? "").trim() : catalog?.spec || "",
          brand: brandColumn >= 0 ? String(row[brandColumn] ?? "").trim() : catalog?.brand || "YIFUN",
          material: materialColumn >= 0 ? String(row[materialColumn] ?? "").trim() : catalog?.material || "",
          note: noteColumn >= 0 ? String(row[noteColumn] ?? "").trim() : catalog?.note || "",
          image: importedImage || catalog?.image || "",
          volume: volumeColumn >= 0 ? String(row[volumeColumn] ?? "").trim() : catalog?.volume || "",
          cost: catalog?.cost ?? null,
          branchPrice: catalog?.branchPrice ?? null,
          supplyMethod: catalog?.supplyMethod ?? null,
          stock: catalog?.stock ?? null,
          majorCategory: catalog?.majorCategory || ("生活场景 / Lifestyle Scene" as MajorCategory),
          category1: catalog?.category1 || "自定义产品",
          category2: catalog?.category2 || currentArea,
          category3: catalog?.category3 || "自定义产品",
          classifications: catalog?.classifications || [],
          tags: catalog?.tags || [catalog?.category3 || "自定义产品"],
          colorTag: importCellText(row[colorColumn]) || catalog?.colorTag || "待确认",
          hasScreen: catalog?.hasScreen || false,
          isRecommended: catalog?.isRecommended || false,
          relatedIds: [],
          catalogProductId: catalog?.id,
          importArea: currentArea,
          importSourceRow: worksheetStartRow + headerIndex + rowOffset + 2,
          importBlueColumns: Array.from({length: 18}, (_, column) => column).filter(column => {
            const cell = worksheet[XLSX.utils.encode_cell({r: sourceRow, c: column})];
            return (cell?.s as {fgColor?: {rgb?: string}} | undefined)?.fgColor?.rgb?.slice(-6).toUpperCase() === "00B0F0";
          }),
          revision: importedRevisions.get(sourceRow + 1) || (() => {
            const columns = [nameColumn, skuColumn, quantityColumn, specificationColumn].filter(column => column >= 0);
            const statuses: Record<string, QuoteRevision["status"]> = {FF0000: "deleted", "92D050": "added", "00B0F0": "modified", FFFF00: "customer"};
            for (const column of columns) {
              const cell = worksheet[XLSX.utils.encode_cell({r: sourceRow, c: column})];
              const rgb = (cell?.s as {fgColor?: {rgb?: string}} | undefined)?.fgColor?.rgb?.slice(-6).toUpperCase();
              if (rgb && statuses[rgb]) return {status: statuses[rgb], changes: [{field: "状态", before: "原表颜色标记", after: revisionLabels[statuses[rgb]], at: new Date().toISOString()}]};
            }
            return undefined;
          })(),
          importSourceQuantity: rawQuantity,
          importSequence: sequenceColumn >= 0 ? importCellText(row[sequenceColumn]) : undefined,
          importSection: currentSection,
        });
        (skus.length ? skus : [""]).forEach((sku) => {
          const product = productBySku.get(sku);
          if (!product && sku) unmatchedSkus.add(sku);
          if (!product) {
            const importedItem = { product: createImportedProduct(sku), quantity };
            imported.push(importedItem);
            importRows.push(importedItem);
            return;
          }
          const matchedItem = { product: createImportedProduct(sku, product), quantity };
          matched.push(matchedItem);
          importRows.push(matchedItem);
        });
      });
      if (!sourceRows)
        throw new Error("表单中没有可导入的产品行");
      const costingBatchId = crypto.randomUUID();
      // Calculate against the backend rules before displaying imported prices.
      for (let offset = 0; offset < importRows.length; offset += 500) {
        const batch = importRows.slice(offset, offset + 500);
        const response = await fetch("/api/quote-costing", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ importBatch: { id: costingBatchId, name: file.name }, items: batch.map(({ product, quantity }) => ({
            id: product.id, quoteQuantity: quantity,
            input: costingInputFromRow(header, rows[(product.importSourceRow || 1) - worksheetStartRow - 1], product, quantity, findImportMeta(rows, headerIndex, /项目名称|project\s*name/i) || inferImportProjectName(rows, headerIndex)),
          })) }),
        });
        const calculated = await response.json();
        if (!response.ok || !Array.isArray(calculated.results)) throw new Error(calculated.error || "自动核算失败，请重新导入清单");
        for (const item of calculated.results) {
          if (!item.matched) continue;
          const product = batch.find(row => row.product.id === item.id)?.product;
          if (!product) continue;
          product.quoteCosting = item.costing;
          product.price = item.costing.saleUnit;
          product.factory = item.costing.saleSource === "catalog" ? item.costing.factorySaleUnit ?? null : item.costing.saleUnit;
          product.usd = item.costing.usdSaleUnit ?? null;
          product.cost = item.cost ?? null;
        }
      }
      const totalRowIndex = rows.findIndex(
        (row, rowIndex) =>
          rowIndex > headerIndex &&
          /总计|grand\s*total|^total\b/i.test(importCellText(row[nameColumn])) && !/小计|subtotal/i.test(importCellText(row[nameColumn])),
      );
      const templateResult = await uploadQuoteTemplate(templateFile);
      const importedFee = (pattern: RegExp) => {
        const row = rows.find((row, index) => index > headerIndex && pattern.test(importCellText(row[nameColumn])));
        return row ? importCellNumber(row[selectedAmountColumn]) : null;
      };
      setQuoteImportPreview({
        fees: { packaging: importedFee(/包装费/i) || 0, formaldehyde: importedFee(/除甲醛/i) || 0, shipping: importedFee(/运输费/i) || 0, installation: importedFee(/安装费/i) || 0, designDeduction: importedFee(/设计费/i) || 0 },
        includeTax: importedFee(/^税额|^tax/i) === null ? true : Number(importedFee(/^税额|^tax/i)) > 0,
        fileName: file.name,
        rows: importRows,
        matched,
        imported,
        unmatchedSkus: [...unmatchedSkus],
        sourceRows,
        projectName:
          findImportMeta(rows, headerIndex, /项目名称|project\s*name/i) ||
          inferImportProjectName(rows, headerIndex),
        designerName: findImportMeta(rows, headerIndex, /设计师|designer/i),
        salesName: findImportMeta(rows, headerIndex, /商务|业务员|sales/i),
      });
      quoteImportTemplateRef.current = {
        headers: header.length >= 18 ? rows[headerIndex].slice(0, 18).map(cell => String(cell ?? "").trim().split(/\n+/)) : undefined,
        feeLabels: Object.fromEntries(([
          ["packaging", /包装费/i], ["formaldehyde", /除甲醛/i], ["shipping", /运输费/i],
          ["installation", /安装费/i], ["subtotal", /小计.*不含税|subtotal.*tax/i], ["tax", /^税额|^tax/i], ["total", /总计|^total/i],
        ] as const).flatMap(([key, pattern]) => {
          const row = rows.find((row, index) => index > headerIndex && pattern.test(importCellText(row[nameColumn])));
          return row ? [[key, importCellText(row[nameColumn])]] : [];
        })),
        feeNotes: Object.fromEntries(([
          ["packaging", /包装费/i], ["formaldehyde", /除甲醛/i], ["shipping", /运输费/i],
          ["installation", /安装费/i], ["subtotal", /小计.*不含税|subtotal.*tax/i], ["tax", /^税额|^tax/i], ["total", /总计|^total/i],
        ] as const).flatMap(([key, pattern]) => {
          const row = rows.find((row, index) => index > headerIndex && pattern.test(importCellText(row[nameColumn])));
          return row ? [[key, row.flatMap((cell, column) => column !== nameColumn && typeof cell === "string" && /[\u4e00-\u9fffA-Za-z]/.test(cell) && !/^=/.test(cell) ? [cell.trim()] : []).join("\n")]] : [];
        })),
        title: rows.slice(0, headerIndex).flat().map(importCellText).find(value => /报价清单|quotation/i.test(value)),
        footerNotes: totalRowIndex < 0 ? [] : rows.slice(totalRowIndex + 1).flatMap(row => {
          const text = String(row[0] ?? "").trim();
          return text && !/合计金额/.test(text) && !/^\d+$/.test(text) ? [text] : [];
        }),
        source,
        id: templateResult.id,
        feeRows: Object.fromEntries([
          ["packaging", /包装费/i], ["formaldehyde", /除甲醛/i], ["shipping", /运输费/i],
          ["installation", /安装费/i], ["designDeduction", /设计费/i], ["subtotal", /小计.*不含税|subtotal.*tax/i], ["tax", /^税额|^tax/i],
        ].flatMap(([key, pattern]) => {
          const index = rows.findIndex((row, rowIndex) => rowIndex > headerIndex && (pattern as RegExp).test(importCellText(row[nameColumn])));
          return index < 0 ? [] : [[key, worksheetStartRow + index + 1]];
        })),
        fileName: templateFile.name,
        headerRow: worksheetStartRow + headerIndex + 1,
        columns: {
          sequence: findImportColumn(header, /序号|^no\.?$/i),
          sku: skuColumn,
          name: nameColumn,
          image: imageColumn,
          brand: brandColumn,
          specification: specificationColumn,
          unit: unitColumn,
          quantity: quantityColumn,
          cnyUnit: cnyUnitColumn,
          cnyAmount: cnyAmountColumn,
          usdUnit: usdUnitColumn,
          usdAmount: usdAmountColumn,
          areaSubtotal: areaSubtotalColumn,
          color: colorColumn,
          note: noteColumn,
          volume: volumeColumn,
          material: materialColumn,
        },
        insertBeforeRow: (() => {
          const summaryRowIndex = rows.findIndex(
            (row, rowIndex) =>
              rowIndex > headerIndex &&
              /包装费|除甲醛|运输费|安装费|小计|税额|总计|合计金额/i.test(
                importCellText(row[nameColumn]),
              ),
          );
          return summaryRowIndex >= 0
            ? worksheetStartRow + summaryRowIndex + 1
            : undefined;
        })(),
        totalRow:
          totalRowIndex >= 0
            ? worksheetStartRow + totalRowIndex + 1
            : undefined,
        metadata: {
          designer: (() => {
            const location = findImportMetaLocation(rows, headerIndex, /设计师|designer/i);
            return location && {
              ...location,
              row: worksheetStartRow + location.row + 1,
            };
          })(),
          sales: (() => {
            const location = findImportMetaLocation(rows, headerIndex, /商务|业务员|sales/i);
            return location && {
              ...location,
              row: worksheetStartRow + location.row + 1,
            };
          })(),
        },
      };
    } catch (error) {
      setQuoteImportError(
        error instanceof Error ? error.message : "读取表单失败，请重新上传 Excel 文件",
      );
    } finally {
      setQuoteImporting(false);
    }
  };
  const applyQuoteImport = () => {
    if (!quoteImportPreview || !quoteImportPreview.rows.length) return;
    setPriceMode(quoteImportPriceMode);
    if (quoteImportPreview.fees) setFees(quoteImportPreview.fees);
    setIncludeTax(quoteImportPreview.includeTax !== false);
    setShowDesignDeduction(Boolean(quoteImportPreview.fees?.designDeduction));
    const importedRows = quoteImportPreview.rows;
    const catalogProductBySku = new Map(
      products.map((product) => [product.sku.toUpperCase(), product]),
    );
    const importedToyBySku = new Map(
      importedRows
        .filter(({ product }) => isToy(product))
        .map(({ product }) => [product.sku.toUpperCase(), product]),
    );
    const nextCart = Object.fromEntries(
      importedRows.map(({ product, quantity }) => [product.id, quantity]),
    ) as Record<string, number>;
    const nextPairings: Record<string, Record<string, number>> = {};
    importedRows.forEach(({ product, quantity }) => {
      const catalogProduct = catalogProductBySku.get(product.sku.toUpperCase());
      const pairedRelations = catalogProduct
        ? relations.filter((relation) => relation.productId === catalogProduct.id)
        : [];
      if (
        !catalogProduct ||
        isToy(catalogProduct) ||
        !pairedRelations.length
      )
        return;
      pairedRelations
        .forEach((relation) => {
          const relatedProduct = products.find(
            (candidate) => candidate.id === relation.relatedProductId,
          );
          if (!relatedProduct) return;
          const importedToy = importedToyBySku.get(relatedProduct.sku.toUpperCase());
          const pairedProduct = importedToy || relatedProduct;
          const pairedQuantity = Math.max(1, relation.quantity || 1) * quantity;
          nextCart[pairedProduct.id] =
            (nextCart[pairedProduct.id] || 0) + pairedQuantity;
          (nextPairings[product.id] ||= {})[pairedProduct.id] =
            (nextPairings[product.id]?.[pairedProduct.id] || 0) + pairedQuantity;
        });
    });
    setImportedProducts(importedRows.map(({ product }) => product));
    setSelectedImportedProductId(importedRows[0]?.product.id || null);
    setExpandedImportedRelations(
      importedRows[0]?.product.id ? new Set([importedRows[0].product.id]) : new Set(),
    );
    setImportedAreaOrder(
      [...new Set(
        importedRows
          .map(({ product }) => product.importArea)
          .filter((area): area is string => Boolean(area)),
      )],
    );
    if (quoteImportPreview.projectName) setQuoteProject(quoteImportPreview.projectName);
    if (quoteImportPreview.designerName) setDesignerName(quoteImportPreview.designerName);
    if (quoteImportPreview.salesName) setSalesName(quoteImportPreview.salesName);
    setCartPairings(nextPairings);
    setCart(nextCart);
    setToyMatchingDraftId("");
    setToyMatchingImportedListName(quoteImportPreview.fileName);
    setToyMatchingOverview(false);
    void loadToyMatchingDrafts();
    setQuoteImportOpen(false);
    setCartOpen(false);
    setImportedQuotePairingOpen(true);
  };
  function storedQuoteTemplate() {
    if (!quoteImportTemplateRef.current) return undefined;
    const template = { ...quoteImportTemplateRef.current };
    delete template.source;
    return template;
  }
  const toyMatchingDraftSnapshot = (): ToyMatchingDraftSnapshot => ({
    version: 1,
    importTemplate: storedQuoteTemplate(),
    cart,
    cartPairings,
    importedProducts,
    importedAreaOrder,
    priceMode,
    workspaceProjectId: workspaceProjectId || undefined,
    projectName: quoteProject,
    contractNo: quoteContractNo,
    designerName,
    salesName,
    importedListName: toyMatchingImportedListName,
    fees, includeTax, showDesignDeduction, companyAddress, installationIncludesTravel,
  });
  const loadToyMatchingDrafts = async () => {
    const response = await fetch("/api/toy-matching-drafts");
    const data = (await response.json()) as { drafts?: ToyMatchingDraft[] };
    if (response.ok) setToyMatchingDrafts(data.drafts || []);
  };
  const saveToyMatchingDraft = async () => {
    if (!importedProducts.length) {
      window.alert("请先导入或添加 SKU，再保存玩具匹配草稿。");
      return;
    }
    setToyMatchingDraftSaving(true);
    try {
      const name = toyMatchingImportedListName.trim() || "未命名导入清单";
      const response = await fetch("/api/toy-matching-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: toyMatchingDraftId || undefined,
          name,
          snapshot: toyMatchingDraftSnapshot(),
        }),
      });
      const data = (await response.json()) as { draft?: ToyMatchingDraft; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "保存失败");
      setToyMatchingDraftId(data.draft.id);
      await loadToyMatchingDrafts();
      setToyMatchingOverview(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "草稿保存失败，请重试。");
    } finally {
      setToyMatchingDraftSaving(false);
    }
  };
  const deleteToyMatchingDraft = async (draft: ToyMatchingDraft) => {
    if (!window.confirm(`确定删除“${draft.name}”吗？此操作无法恢复。`)) return;
    try {
      const response = await fetch(`/api/toy-matching-drafts?id=${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "删除失败");
      if (toyMatchingDraftId === draft.id) setToyMatchingDraftId("");
      await loadToyMatchingDrafts();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "草稿删除失败，请重试。");
    }
  };
  const restoreToyMatchingDraft = async (draft: ToyMatchingDraft) => {
    try {
      const response = await fetch(`/api/toy-matching-drafts?id=${encodeURIComponent(draft.id)}`);
      const data = (await response.json()) as { draft?: ToyMatchingDraft; error?: string };
      const snapshot = data.draft?.snapshot;
      if (!response.ok || !data.draft || !snapshot) throw new Error(data.error || "读取草稿失败");
      setWorkspaceProjectId(snapshot.workspaceProjectId || "");
      quoteImportTemplateRef.current = snapshot.importTemplate || null;
      setFees({
        packaging: Number(snapshot.fees?.packaging) || 0,
        formaldehyde: Number(snapshot.fees?.formaldehyde) || 0,
        shipping: Number(snapshot.fees?.shipping) || 0,
        installation: Number(snapshot.fees?.installation) || 0,
        designDeduction: Number(snapshot.fees?.designDeduction) || 0,
      });
      setIncludeTax(snapshot.includeTax !== false);
      setShowDesignDeduction(Boolean(snapshot.showDesignDeduction));
      setCompanyAddress(snapshot.companyAddress || "");
      setInstallationIncludesTravel(snapshot.installationIncludesTravel !== false);
      setQuoteQuantityDrafts({});
      setCart(snapshot.cart || {});
      setCartPairings(snapshot.cartPairings || {});
      setImportedProducts(snapshot.importedProducts || []);
      setImportedAreaOrder(snapshot.importedAreaOrder || []);
      setRestoredQuoteProducts([]);
      setPriceMode(["factory", "vip", "usd"].includes(snapshot.priceMode) ? snapshot.priceMode : "vip");
      setQuoteProject(snapshot.projectName || "");
      setQuoteContractNo(snapshot.contractNo || "");
      setDesignerName(snapshot.designerName || "");
      setSalesName(snapshot.salesName || "");
      setToyMatchingImportedListName(snapshot.importedListName || draft.name);
      setToyMatchingDraftId(data.draft.id);
      setSelectedImportedProductId(snapshot.importedProducts?.[0]?.id || null);
      setExpandedImportedRelations(
        snapshot.importedProducts?.[0]?.id ? new Set([snapshot.importedProducts[0].id]) : new Set(),
      );
      setToyMatchingOverview(false);
      setImportedQuotePairingOpen(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "草稿读取失败，请重试。");
    }
  };
  const openToyMatchingWorkspace = () => {
    void loadToyMatchingDrafts();
    setToyMatchingOverview(true);
    setImportedQuotePairingOpen(true);
    setCartOpen(false);
  };
  const addCatalogProductToToyMatching = (catalogProduct: Product) => {
    const existing = importedProducts.find(
      (product) => product.catalogProductId === catalogProduct.id || product.sku === catalogProduct.sku,
    );
    if (existing) {
      setCart((current) => ({ ...current, [existing.id]: (current[existing.id] || 0) + 1 }));
      setSelectedImportedProductId(existing.id);
    } else {
      const product: Product = {
        ...catalogProduct,
        id: `imported-manual-${crypto.randomUUID()}`,
        catalogProductId: catalogProduct.id,
        revision: {status: "added", changes: [{field: "状态", before: "", after: revisionLabels.added, at: new Date().toISOString()}]},
        importArea: catalogProduct.category2,
      };
      setImportedProducts((current) => [...current, product]);
      setImportedAreaOrder((current) =>
        current.includes(product.importArea || product.category2)
          ? current
          : [...current, product.importArea || product.category2],
      );
      setCart((current) => ({ ...current, [product.id]: 1 }));
      setSelectedImportedProductId(product.id);
    }
    setMatchingSkuPickerOpen(false);
    setMatchingSkuQuery("");
  };
  const matchingSkuCandidates = products
    .filter((product) => {
      const term = matchingSkuQuery.trim().toLowerCase();
      return !term || [product.sku, product.name, product.en, product.category2]
        .join(" ")
        .toLowerCase()
        .includes(term);
    })
    .slice(0, 80);
  const quoteDateStamp = () => {
    const date = new Date();
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  };
  const quoteExportFileName = () =>
    `${quoteProject.trim().replace(/[\\/:*?"<>|]/g, "-")}_${quoteDateStamp()}`;
  const quotationHistorySnapshot = (): QuoteHistorySnapshot => ({
    version: 1,
    importTemplate: storedQuoteTemplate(),
    products: quoteProducts.filter((product) => Object.hasOwn(cart, product.id)),
    cart,
    cartPairings,
    importedProducts: importedProducts.map(product => quoteProducts.find(item => item.id === product.id) || product),
    importedAreaOrder,
    priceMode,
    workspaceProjectId: workspaceProjectId || undefined,
    projectName: quoteProject,
    contractNo: quoteContractNo,
    designerName,
    salesName,
    companyAddress,
    installationIncludesTravel,
    includeTax,
    showDesignDeduction,
    fees,
  });
  const restoreQuotation = async (
    quotation: QuotationHistoryRecord,
    mode: QuoteHistoryMode = "view",
    exportFormat: HistoryExportFormat | null = null,
  ) => {
    if (quotation.voidedAt) { mode = "view"; exportFormat = null; }
    setQuoteHistoryNotice(quotation.voidedAt ? "此报价已作废，仅供查阅历史，不可继续使用。" : quotation.finalAmount != null ? `最终成交价格 ${money(quotation.finalAmount, quotation.finalCurrency === "USD" ? "USD" : "CNY")}；下方保留原报价内容。` : "");
    const snapshot = quotation.snapshot;
    setWorkspaceProjectId(snapshot?.workspaceProjectId || "");
    setQuoteHistorySaving(false);
    setQuoteQuantityDrafts({});
    setQuoteImportPreview(null);
    quoteImportTemplateRef.current = snapshot?.importTemplate || null;
    setRecordedQuoteHistoryId(mode === "view" || mode === "export" ? quotation.id : "");
    setQuoteHistoryLineageId(mode === "edit" ? quotation.lineageId || quotation.id : "");
    setQuoteHistoryMode(mode);
    setQuoteActiveTab(mode === "view" || mode === "export" ? "all" : "summary");
    setQuoteExpandedAreas(new Set());
    setImportedQuotePairingOpen(false);
    setToyMatchingDraftId("");
    setCartOpen(false);
    setQuoteOpen(true);
    window.history.replaceState({}, "", "/");
    if (!snapshot) {
      clearQuotation();
      setQuoteProject(quotation.projectName);
      setQuoteContractNo(quotation.contractNo);
      window.alert("这是一条旧历史记录，只保存了项目名称和合同号。已带入项目资料，请重新选择产品后生成新报价单。");
    } else {
      setCart(snapshot.cart || {});
      setCartPairings(snapshot.cartPairings || {});
      setImportedProducts(snapshot.importedProducts || []);
      setImportedAreaOrder(snapshot.importedAreaOrder || []);
      try {setRestoredQuoteProducts(await bilingualQuoteProducts(snapshot.products || []));}
      catch (error) {setRestoredQuoteProducts(snapshot.products || []); window.alert(error instanceof Error ? error.message : "历史报价翻译未完成，请重试");}
      setPriceMode(["factory", "vip", "usd"].includes(snapshot.priceMode) ? snapshot.priceMode : "vip");
      setQuoteProject(quotation.projectName);
      setQuoteContractNo(quotation.contractNo);
      setDesignerName(snapshot.designerName || "");
      setSalesName(snapshot.salesName || "");
      setCompanyAddress(snapshot.companyAddress || "");
      setInstallationIncludesTravel(snapshot.installationIncludesTravel !== false);
      setIncludeTax(snapshot.includeTax !== false);
      setShowDesignDeduction(Boolean(snapshot.showDesignDeduction));
      setFees({
        packaging: Number(snapshot.fees?.packaging) || 0,
        formaldehyde: Number(snapshot.fees?.formaldehyde) || 0,
        shipping: Number(snapshot.fees?.shipping) || 0,
        installation: Number(snapshot.fees?.installation) || 0,
        designDeduction: Number(snapshot.fees?.designDeduction) || 0,
      });
    }
    if (mode === "edit") {
      const response = await fetch(
        `/api/quotation-history?nextRevisionOf=${encodeURIComponent(quotation.id)}`,
      );
      const data = (await response.json()) as { contractNo?: string };
      if (!response.ok || !data.contractNo) {
        window.alert("无法生成新项目编号，请返回历史报价单后重试。");
        return;
      }
      setQuoteContractNo(data.contractNo);
    }
    if (mode === "export" && exportFormat) setPendingHistoryExport(exportFormat);
  };
  const checkCostedQuote = () => {
    const pending = quoteCartItems.find(p => !excludedFromQuote(p) && p.quoteCosting && (p.quoteCosting.status !== "ready" || (priceMode === "usd" ? p.usd == null : priceMode === "factory" && p.quoteCosting.saleSource === "catalog" ? p.factory == null : p.price == null)));
    if (!pending) return true;
    window.alert(`${pending.sku}：${pending.quoteCosting?.status === "pending" ? pending.quoteCosting.issues.join("；") : pending.quoteCosting?.saleSource === "catalog" ? "产品库未填写当前报价模式的售价" : "尚未配置美元售价，请核实汇率"}。请补齐售价或核算规则后重新导入。`);
    return false;
  };
  const recordQuoteHistory = async () => {
    if (workspaceProjectId && !workplaceReady) { window.alert(workplaceNotice || "请等待项目关联确认后再保存。"); return false; }
    const projectName = quoteProject.trim();
    const contractNo = quoteContractNo.trim();
    if (!projectName || !contractNo) {
      window.alert("请先填写项目名称和项目合同号，再导出报价单。");
      return false;
    }
    setQuoteHistorySaving(true);
    try {
      const response = await fetch("/api/quotation-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: recordedQuoteHistoryId || undefined,
          projectName,
          contractNo,
          lineageId: quoteHistoryLineageId || undefined,
          snapshot: quotationHistorySnapshot(),
        }),
      });
      const data = (await response.json()) as {
        quotation?: QuotationHistoryRecord;
        error?: string;
      };
      if (!response.ok || !data.quotation) {
        window.alert(data.error || "报价历史保存失败，请重试。");
        return false;
      }
      setRecordedQuoteHistoryId(data.quotation.id);
      setQuoteHistoryLineageId(data.quotation.lineageId || "");
      window.localStorage.removeItem(activeQuotationStorageKey);
      if (data.quotation.contractNo && data.quotation.contractNo !== contractNo) {
        setQuoteContractNo(data.quotation.contractNo);
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => resolve()),
          ),
        );
      }
      return true;
    } catch {
      window.alert("报价历史保存失败，请检查网络后重试。");
      return false;
    } finally {
      setQuoteHistorySaving(false);
    }
  };
  const exportImportedQuoteTemplate = async (fileName: string) => {
    const template = quoteImportTemplateRef.current;
    const sourceProducts = (importedProducts.length ? importedProducts : quoteImportPreview?.rows.map(({ product }) => product) || []).map(product => quoteProducts.find(item => item.id === product.id) || product);
    if (!template || !sourceProducts.length) return false;
    try {
      if (!template.source) {
        if (!template.id) throw new Error("历史记录没有原始模板，请重新导入原表");
        const response = await fetch(`/api/quote-template?id=${encodeURIComponent(template.id)}`);
        if (!response.ok) throw new Error("原始模板读取失败，请重新登录或重试");
        template.source = await response.arrayBuffer();
      }
      const files = unzipSync(new Uint8Array(template.source));
      const worksheetPath = Object.keys(files).find((path) =>
        /^xl\/worksheets\/sheet\d+\.xml$/.test(path),
      );
      if (!worksheetPath || !files[worksheetPath]) return false;
      let xml = await prepareQuoteTemplateImages(files, worksheetPath);
      const originalXml = xml;
      const originalAmount = (row: number | undefined, column: number) => {
        if (!row) return 0;
        const ref = XLSX.utils.encode_cell({ r: row - 1, c: column });
        return Number(originalXml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*>([\\s\\S]*?)<\\/c>`))?.[1].match(/<v>([^<]+)<\/v>/)?.[1]) || 0;
      };
      const setCell = (row: number, column: number, value: string | number | null) => {
        if (column < 0 || value === null || value === undefined) return;
        xml = updateTemplateCell(
          xml,
          XLSX.utils.encode_cell({ r: row - 1, c: column }),
          value,
        );
      };
      const setFormula = (
        row: number,
        column: number,
        formula: string,
        value: number,
      ) => {
        if (column < 0) return;
        xml = updateTemplateFormula(
          xml,
          XLSX.utils.encode_cell({ r: row - 1, c: column }),
          formula,
          value,
        );
      };
      const sourceLines = [
        ...new Map(
          sourceProducts
            .filter(
              (product) =>
                product.importSourceRow !== undefined &&
                product.importSourceRow > template.headerRow,
            )
            .map((product) => [product.importSourceRow!, product]),
        ).values(),
      ].sort((a, b) => a.importSourceRow! - b.importSourceRow!);
      const sourceProductIds = new Set(sourceLines.map((product) => product.id));
      const addedItems = quoteItemsInOrder.filter((item) => !sourceProductIds.has(item.product.id));
      const addedImageFormulas = template.columns.image >= 0
        ? await embedQuoteImages(files, addedItems.map(({ product }) => product))
        : new Map<string, string>();
      const columnName = (column: number) => XLSX.utils.encode_col(column);
      const addedItemRows: Array<{
        product: Product;
        quantity: number;
        row: number;
      }> = [];
      let totalRow = template.totalRow;
      let insertedRows = 0;
      if (addedItems.length) {
        const rowXmlByNumber = new Map<number, string>();
        for (const row of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g))
          rowXmlByNumber.set(Number(row[1]), row[0]);
        const firstSourceRow = sourceLines[0]?.importSourceRow;
        const itemPrototypeRow = sourceLines.at(-1)?.importSourceRow;
        const itemPrototype = itemPrototypeRow
          ? rowXmlByNumber.get(itemPrototypeRow)
          : undefined;
        if (!itemPrototype || !itemPrototypeRow) return false;
        const areaPrototypeRow =
          firstSourceRow && firstSourceRow > template.headerRow + 1
            ? firstSourceRow - 1
            : undefined;
        const areaPrototype = areaPrototypeRow
          ? rowXmlByNumber.get(areaPrototypeRow)
          : undefined;
        const insertionRow =
          template.insertBeforeRow ||
          totalRow ||
          Math.max(...sourceLines.map((product) => product.importSourceRow || 0)) + 1;
        const groupedAddedItems = Object.entries(
          addedItems.reduce<Record<string, typeof addedItems>>((groups, item) => {
            (groups[item.area] ||= []).push(item);
            return groups;
          }, {}),
        );
        const addedRowCount = addedItems.length +
          (areaPrototype ? groupedAddedItems.length : 0);
        insertedRows = addedRowCount;
        const shiftReference = (reference: string) =>
          // Quoted image IDs, URLs and sheet names are not cell references.
          reference.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'|&quot;[\s\S]*?&quot;|&apos;[\s\S]*?&apos;|(\$?[A-Z]{1,3}\$?)(\d+)/g, (match, column, row) =>
            column && Number(row) >= insertionRow ? `${column}${Number(row) + addedRowCount}` : match,
          );
        xml = xml
          .replace(/(<row\b[^>]*\br=")(\d+)("[^>]*>)/g, (_row, start, row, end) =>
            Number(row) >= insertionRow ? `${start}${Number(row) + addedRowCount}${end}` : _row,
          )
          .replace(/(\br=")([A-Z]+)(\d+)(")/g, (_cell, start, column, row, end) =>
            Number(row) >= insertionRow ? `${start}${column}${Number(row) + addedRowCount}${end}` : _cell,
          )
          .replace(/(<f(?:\s[^>]*)?>)([\s\S]*?)(<\/f>)/g, (_formula, start, body, end) =>
            `${start}${shiftReference(body)}${end}`,
          )
          .replace(/\b(ref|sqref)="([^"]+)"/g, (_reference, attribute, value) =>
            `${attribute}="${shiftReference(value)}"`,
          );
        totalRow = totalRow ? totalRow + addedRowCount : undefined;
        const areaAnchor = (() => {
          const cellReference = areaPrototype?.match(/<c\b[^>]*\br="([A-Z]+)\d+"/)?.[1];
          return cellReference
            ? XLSX.utils.decode_col(cellReference)
            : template.columns.name >= 0
              ? template.columns.name
              : template.columns.sku;
        })();
        const setAddedCell = (
          rowXml: string,
          row: number,
          column: number,
          value: string | number,
        ) =>
          column >= 0
            ? updateTemplateRowCell(rowXml, row, column, value)
            : rowXml;
        const setAddedFormula = (
          rowXml: string,
          row: number,
          column: number,
          formula: string,
          value: number,
        ) =>
          column >= 0
            ? updateTemplateRowFormula(rowXml, row, column, formula, value)
            : rowXml;
        const addedRows: string[] = [];
        const addedAreaMergeRefs = areaPrototypeRow
          ? [...strFromU8(files[worksheetPath])
              .matchAll(/<mergeCell\s+ref="([A-Z]+\d+:[A-Z]+\d+)"\/>/g)]
              .map((match) => match[1])
              .filter((ref) =>
                new RegExp(`^[A-Z]+${areaPrototypeRow}:[A-Z]+${areaPrototypeRow}$`).test(ref),
              )
          : [];
        let destinationRow = insertionRow;
        let addedSequence = sourceLines.length;
        groupedAddedItems.forEach(([area, items]) => {
          let areaRow: string | undefined;
          const firstItemRow = destinationRow + (areaPrototype ? 1 : 0);
          if (areaPrototype && areaPrototypeRow) {
            areaRow = templateRow(areaPrototype, areaPrototypeRow, destinationRow);
            areaRow = setAddedCell(areaRow, destinationRow, areaAnchor, area);
            destinationRow += 1;
          }
          items.forEach((item) => {
            const { product, quantity } = item;
            const row = destinationRow;
            let productRow = templateRow(itemPrototype, itemPrototypeRow, row);
            const englishName = needsEnglishTranslation(product)
              ? ""
              : englishProductName(product);
            productRow = setAddedCell(productRow, row, template.columns.sequence, ++addedSequence);
            productRow = setAddedCell(productRow, row, template.columns.sku, product.sku);
            productRow = setAddedCell(
              productRow,
              row,
              template.columns.name,
              englishName ? `${product.name}\n${englishName}` : product.name,
            );
            if (template.columns.image >= 0) {
              const imageFormula = addedImageFormulas.get(product.id);
              productRow = imageFormula
                ? updateTemplateRowTextFormula(
                    productRow,
                    row,
                    template.columns.image,
                    imageFormula,
                  )
                : setAddedCell(productRow, row, template.columns.image, "");
            }
            productRow = setAddedCell(productRow, row, template.columns.brand, product.brand || "YIFUN");
            productRow = setAddedCell(productRow, row, template.columns.specification, product.spec || "");
            productRow = setAddedCell(productRow, row, template.columns.unit, product.unit || "");
            productRow = setAddedCell(productRow, row, template.columns.quantity, quantity);
            productRow = setAddedCell(productRow, row, template.columns.cnyUnit, product.price || 0);
            if (template.columns.cnyUnit >= 0 && template.columns.cnyAmount >= 0)
              productRow = setAddedFormula(
                productRow,
                row,
                template.columns.cnyAmount,
                `=${columnName(template.columns.quantity)}${row}*${columnName(template.columns.cnyUnit)}${row}`,
                (product.price || 0) * quantity,
              );
            productRow = setAddedCell(productRow, row, template.columns.usdUnit, product.usd || 0);
            if (template.columns.usdUnit >= 0 && template.columns.usdAmount >= 0)
              productRow = setAddedFormula(
                productRow,
                row,
                template.columns.usdAmount,
                `=${columnName(template.columns.quantity)}${row}*${columnName(template.columns.usdUnit)}${row}`,
                (product.usd || 0) * quantity,
              );
            productRow = setAddedCell(productRow, row, template.columns.color, product.colorTag || "");
            productRow = setAddedCell(
              productRow,
              row,
              template.columns.note,
              product.note ? (product.note.includes(englishRemark(product.note)) ? product.note : `${product.note}\n${englishRemark(product.note)}`) : "",
            );
            productRow = setAddedCell(productRow, row, template.columns.volume, product.volume || "");
            if (template.columns.material !== undefined)
              productRow = setAddedCell(productRow, row, template.columns.material, product.material || "");
            addedRows.push(productRow);
            addedItemRows.push({ product, quantity, row });
            destinationRow += 1;
          });
          if (areaRow) {
            const areaAmountColumn =
              template.columns.usdAmount >= 0
                ? template.columns.usdAmount
                : template.columns.cnyAmount;
            areaRow = setAddedFormula(
              areaRow,
              firstItemRow - 1,
              template.columns.areaSubtotal,
              `=SUM(${columnName(areaAmountColumn)}${firstItemRow}:${columnName(areaAmountColumn)}${destinationRow - 1})`,
              items.reduce(
                (total, item) =>
                  total +
                  ((areaAmountColumn === template.columns.usdAmount
                    ? item.product.usd
                    : item.product.price) || 0) *
                    billableQuantity(item.product, item.quantity),
                0,
              ),
            );
            addedRows.splice(addedRows.length - items.length, 0, areaRow);
          }
        });
        const shiftedInsertionRow = insertionRow + addedRowCount;
        const insertionPattern = new RegExp(
          `(<row\\b[^>]*\\br="${shiftedInsertionRow}"[^>]*>)`,
        );
        xml = insertionPattern.test(xml)
          ? xml.replace(insertionPattern, `${addedRows.join("")}$1`)
          : xml.replace("</sheetData>", `${addedRows.join("")}</sheetData>`);
        if (addedAreaMergeRefs.length) {
          const extraMerges = groupedAddedItems.flatMap((_, index) => {
            const row = insertionRow + index +
              groupedAddedItems.slice(0, index).reduce(
                (count, [, items]) => count + items.length,
                0,
              );
            return addedAreaMergeRefs.map((ref) =>
              ref.replace(/([A-Z]+)\d+:([A-Z]+)\d+/, `$1${row}:$2${row}`),
            );
          });
          xml = xml.replace(/<mergeCells\b([^>]*)>([\s\S]*?)<\/mergeCells>/, (_merges, attributes, body) => {
            const count = [...body.matchAll(/<mergeCell\b/g)].length + extraMerges.length;
            return `<mergeCells${attributes.replace(/\s+count="[^"]*"/, "")} count="${count}">${body}${extraMerges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`;
          });
        }
      }
      sourceLines.forEach((product) => {
        const row = product.importSourceRow!;
        const quantity = cart[product.id] || 0;
        setCell(row, template.columns.quantity, product.importSourceQuantity === null && quantity === 1 ? "" : quantity);
        const englishName = needsEnglishTranslation(product) ? "" : englishProductName(product);
        setCell(row, template.columns.name, englishName && !product.name.includes(englishName) ? `${product.name}\n${englishName}` : product.name);
        if (product.brand !== undefined) setCell(row, template.columns.brand, product.brand || "");
        if (product.spec !== undefined) setCell(row, template.columns.specification, product.spec || "");
        if (product.unit !== undefined) setCell(row, template.columns.unit, product.unit || "");
        if (product.note !== undefined) setCell(row, template.columns.note, product.note || "");
        if (product.volume !== undefined) setCell(row, template.columns.volume, product.volume || "");
        if (template.columns.material !== undefined && product.material !== undefined)
          setCell(row, template.columns.material, product.material || "");
        setCell(row, template.columns.cnyUnit, product.price);
        setCell(row, template.columns.usdUnit, product.usd ?? "");
        if (template.columns.cnyUnit >= 0 && template.columns.cnyAmount >= 0)
          setFormula(
            row,
            template.columns.cnyAmount,
            excludedFromQuote(product) ? "=0" : `=${columnName(template.columns.quantity)}${row}*${columnName(template.columns.cnyUnit)}${row}`,
            (product.price || 0) * billableQuantity(product, quantity),
          );
        if (template.columns.usdUnit >= 0 && template.columns.usdAmount >= 0) {
          if (product.usd == null) setCell(row, template.columns.usdAmount, "");
          else setFormula(
            row,
            template.columns.usdAmount,
            excludedFromQuote(product) ? "=0" : `=${columnName(template.columns.quantity)}${row}*${columnName(template.columns.usdUnit)}${row}`,
            product.usd * billableQuantity(product, quantity),
          );
        }
      });
      const amountColumn =
        template.columns.usdAmount >= 0
          ? template.columns.usdAmount
          : template.columns.cnyAmount;
      const amountValue = (product: Product) =>
        (amountColumn === template.columns.usdAmount ? product.usd : product.price) || 0;
      Object.values(
        sourceLines.reduce<Record<string, Product[]>>((groups, product) => {
          (groups[`${product.importArea || "导入项目"}\u001f${product.importSection ?? ""}`] ||= []).push(product);
          return groups;
        }, {}),
      ).forEach((areaLines) => {
        const firstRow = areaLines[0].importSourceRow!;
        const lastRow = areaLines.at(-1)!.importSourceRow!;
        setFormula(
          areaLines[0].importSection ? areaLines[0].importSection + 1 : firstRow,
          template.columns.areaSubtotal,
          `=SUM(${columnName(amountColumn)}${firstRow}:${columnName(amountColumn)}${lastRow})`,
          areaLines.reduce(
            (total, product) => total + amountValue(product) * billableQuantity(product, cart[product.id] || 0),
            0,
          ),
        );
      });
      const exportLineItems = [
        ...sourceLines.map((product) => ({
          product,
          quantity: cart[product.id] || 0,
          row: product.importSourceRow!,
        })),
        ...addedItemRows,
      ];
      // Fill costs in the original sheet without rebuilding its images or layout.
      const canExportCost = ["admin", "ceo", "cost_accountant"].includes(authAccount?.role || "");
      const sourceBook = XLSX.read(template.source, { type: "array" });
      const sourceSheet = sourceBook.Sheets[sourceBook.SheetNames[0]];
      const range = XLSX.utils.decode_range(sourceSheet["!ref"] || "A1");
      const costColumns: number[] = [];
      let costUnit = -1, costAmount = -1;
      for (let col = 0; col <= range.e.c; col++) {
        const label = String(sourceSheet[XLSX.utils.encode_cell({ r: template.headerRow - 1, c: col })]?.v || "");
        if (!/成本|\bcost\b/i.test(label)) continue;
        costColumns.push(col);
        if (/合计|总|金额|amount|total|成本价(?!.*单价)/i.test(label)) costAmount = col;
        else costUnit = col;
      }
      // Remove stale source costs, including subtotals, for every role before filling authorized values.
      const costLetters = new Set(costColumns.map(columnName));
      xml = xml.replace(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cell, col, row) => {
        if (!costLetters.has(col) || Number(row) <= template.headerRow) return cell;
        if (/←.*选择/.test(String(sourceSheet[`${col}${Number(row) - (Number(row) >= (template.insertBeforeRow || Infinity) + insertedRows ? insertedRows : 0)}`]?.v || ""))) return cell;
        // Clear values and formulas, but retain borders, alignment and number formats.
        return cell.replace(/\s+t="[^"]*"/g, "").replace(/\s*\/>$|>[\s\S]*$/, "/>");
      });
      if (canExportCost) {
        let nextColumn = range.e.c + 1;
        if (costUnit < 0) {
          costUnit = nextColumn++;
          setCell(template.headerRow, costUnit, "成本单价（人民币） / Unit Cost (CNY)");
        }
        if (costAmount < 0) {
          costAmount = nextColumn++;
          setCell(template.headerRow, costAmount, "成本合计（人民币） / Total Cost (CNY)");
        }
        exportLineItems.forEach(({ product, quantity, row }) => {
          const cost = typeof product.cost === "number" && Number.isFinite(product.cost) ? product.cost : null;
          setCell(row, costUnit, cost ?? "");
          if (cost === null) setCell(row, costAmount, "");
          else setFormula(row, costAmount, `=${columnName(template.columns.quantity)}${row}*${columnName(costUnit)}${row}`, Math.round(cost * quantity * 100) / 100);
        });
        if (totalRow) {
          const complete = exportLineItems.filter(item => item.quantity > 0 && !excludedFromQuote(item.product)).every(item => typeof item.product.cost === "number" && Number.isFinite(item.product.cost));
          setCell(totalRow, costAmount, complete ? Math.round(exportLineItems.reduce((sum, item) => sum + (item.product.cost || 0) * billableQuantity(item.product, item.quantity), 0) * 100) / 100 : "待补齐成本 / Cost Pending");
        }
        const lastColumn = Math.max(range.e.c, costUnit, costAmount);
        xml = xml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${columnName(lastColumn)}${Math.max(range.e.r + 1 + insertedRows, totalRow || 0)}"/>`);
        const addedCostColumns = [costUnit, costAmount].filter(col => col > range.e.c).map(col => `<col min="${col + 1}" max="${col + 1}" width="28" customWidth="1"/>`).join("");
        if (addedCostColumns) xml = xml.includes("</cols>") ? xml.replace("</cols>", `${addedCostColumns}</cols>`) : xml.replace(/<sheetData\b/, `<cols>${addedCostColumns}</cols><sheetData`);
        // Imported templates may hide their cost columns: explicitly expose only those two columns.
        xml = xml.replace(/<col\b([^>]*?)\/>/g, (tag, attrs: string) => {
          const min = Number(attrs.match(/\bmin="(\d+)"/)?.[1]), max = Number(attrs.match(/\bmax="(\d+)"/)?.[1]);
          if (!/\bhidden="1"/.test(attrs) || ![costUnit + 1, costAmount + 1].some(c => c >= min && c <= max)) return tag;
          let result = "";
          for (let col = min; col <= max; col++) {
            let a = attrs.replace(/\bmin="\d+"/, `min="${col}"`).replace(/\bmax="\d+"/, `max="${col}"`);
            if (col === costUnit + 1 || col === costAmount + 1) a = a.replace(/\s*hidden="[^"]*"/g, "");
            result += `<col${a}/>`;
          }
          return result;
        });
      }
      if (totalRow && exportLineItems.length) {
        for (const [exportCurrency, amountColumn] of [["CNY", template.columns.cnyAmount], ["USD", template.columns.usdAmount]] as const) {
          if (amountColumn < 0) continue;
          const selected = exportCurrency === currency;
          const exportFees = selected ? fees : {
            packaging: originalAmount(template.feeRows?.packaging, amountColumn), formaldehyde: originalAmount(template.feeRows?.formaldehyde, amountColumn),
            shipping: originalAmount(template.feeRows?.shipping, amountColumn), installation: originalAmount(template.feeRows?.installation, amountColumn),
            designDeduction: originalAmount(template.feeRows?.designDeduction, amountColumn),
          };
          const exportTax = selected ? includeTax : template.feeRows?.tax ? originalAmount(template.feeRows.tax, amountColumn) > 0 : includeTax;
          const exportDeduction = selected ? showDesignDeduction : Boolean(exportFees.designDeduction);
          const rowTotal = exportLineItems.reduce((sum, item) => sum + (exportCurrency === "USD" ? item.product.usd || 0 : item.product.price || 0) * billableQuantity(item.product, item.quantity), 0);
          const totals = quotationTotals(rowTotal, exportCurrency, exportFees, exportTax, exportDeduction);
          const rowReference = (row: number) => `${columnName(amountColumn)}${row}`;
          const productFormula = exportLineItems.map((item) => rowReference(item.row)).join("+") || "0";
          const feeAmount = exportFees.packaging + exportFees.formaldehyde + exportFees.shipping + exportFees.installation;
          const deduction = exportDeduction ? exportFees.designDeduction : 0;
          setFormula(totalRow, amountColumn, `=(${productFormula}+${feeAmount})*${exportCurrency === "CNY" && exportTax ? 1.13 : 1}-${deduction}`, totals.totalWithTax);
          for (const [key, originalRow] of Object.entries(template.feeRows || {})) {
            const row = originalRow + (originalRow >= (template.insertBeforeRow || template.totalRow || Infinity) ? insertedRows : 0);
            const amount = key === "subtotal" ? totals.preTax : key === "tax" ? totals.tax : key === "designDeduction" ? deduction : exportFees[key as keyof typeof exportFees];
            setCell(row, amountColumn, amount || 0);
          }
        }
      }

      if (template.metadata.designer)
        setCell(
          template.metadata.designer.row,
          template.metadata.designer.column,
          designerName,
        );
      if (template.metadata.sales)
        setCell(
          template.metadata.sales.row,
          template.metadata.sales.column,
          salesName,
        );
      xml = restoreTemplatePriceStyles(xml, new Set(exportLineItems.map((item) => item.row)), [
        [template.columns.cnyUnit, template.columns.cnyAmount],
        [template.columns.usdUnit, template.columns.usdAmount],
      ]);
      xml = formatQuoteCurrencyCells(files, xml, template.headerRow, [template.columns.cnyUnit, template.columns.cnyAmount, costUnit, costAmount]);
      files[worksheetPath] = strToU8(normalizeTemplateCellOrder(xml));
      applyQuoteRevisions(files, worksheetPath, exportLineItems, {quantity: template.columns.quantity, specification: template.columns.specification, amounts: [template.columns.cnyAmount, template.columns.usdAmount, costAmount].filter(column => column >= 0)});
      downloadExcelFile(new Uint8Array(await translateQuoteWorkbook(zipSync(files, { level: 6 }).buffer as ArrayBuffer)), `${fileName}.xlsx`);
      return true;
    } catch {
      return false;
    }
  };
  const exportQuoteExcel = async (saveHistory = true) => {
    if (!checkCostedQuote()) return;
    if (saveHistory && !(await recordQuoteHistory())) return;
    if (quoteImportTemplateRef.current) {
      if (!(await exportImportedQuoteTemplate(quoteExportFileName()))) window.alert("原始模板导出失败，请重试；原始模板和报价内容仍已保留。");
      return;
    }
    try {
      const response = await fetch(
        "/quotation-templates/YIFUNLIFE_MINIMDO_AUS_PRODUCTS_QUOTATION.xlsx",
      );
      if (!response.ok) throw new Error("未能读取报价模板");
      const source = await response.arrayBuffer();
      const files = unzipSync(new Uint8Array(source));
      const worksheetPath = "xl/worksheets/sheet1.xml";
      if (!files[worksheetPath]) throw new Error("报价模板缺少主表");
      let xml = strFromU8(files[worksheetPath]);
      const sheetData = xml.match(/<sheetData[^>]*>([\s\S]*?)<\/sheetData>/)?.[1];
      if (!sheetData) throw new Error("报价模板主表格式无效");
      const sourceRows = new Map<number, string>();
      for (const row of sheetData.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g))
        sourceRows.set(Number(row[1]), row[0]);
      const areaPrototype = sourceRows.get(4);
      const itemPrototype = sourceRows.get(5);
      if (!areaPrototype || !itemPrototype) throw new Error("报价模板缺少分区或产品行");

      const workbook = XLSX.read(source, { type: "array" });
      const templateSheet = workbook.Sheets[workbook.SheetNames[0]];
      const templateImageFormulaBySku = new Map<string, string>();
      if (templateSheet) {
        for (let row = 5; row <= 115; row += 1) {
          const sku = String(templateSheet[`B${row}`]?.v || "").trim().toUpperCase();
          const imageFormula = templateSheet[`D${row}`]?.f;
          if (sku && imageFormula) templateImageFormulaBySku.set(sku, imageFormula);
        }
      }
      const embeddedImageFormulaByProductId = new Map<string, string>();
      const cellImagesPath = "xl/cellimages.xml";
      const cellImagesRelsPath = "xl/_rels/cellimages.xml.rels";
      let cellImagesXml = files[cellImagesPath] ? strFromU8(files[cellImagesPath]) : "";
      let cellImagesRelsXml = files[cellImagesRelsPath] ? strFromU8(files[cellImagesRelsPath]) : "";
      const cellImageEntries: string[] = [];
      const cellImageRelationships: string[] = [];
      let nextCellImageId = Math.max(
        0,
        ...[...cellImagesXml.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1])),
      ) + 1;
      let nextRelationshipId = Math.max(
        0,
        ...[...cellImagesRelsXml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1])),
      ) + 1;
      let nextMediaId = Math.max(
        0,
        ...Object.keys(files).map((path) => Number(path.match(/^xl\/media\/image(\d+)\./)?.[1] || 0)),
      ) + 1;
      const embedProductImage = async (product: Product) => {
        if (!product.image || embeddedImageFormulaByProductId.has(product.id)) return;
        try {
          const response = await fetch(product.image);
          if (!response.ok) return;
          const sourceBlob = await response.blob();
          const sourceUrl = URL.createObjectURL(sourceBlob);
          const sourceImage = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("image load failed"));
            image.src = sourceUrl;
          });
          const longestSide = Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight);
          if (!longestSide) {
            URL.revokeObjectURL(sourceUrl);
            return;
          }
          const scale = Math.min(1, 180 / longestSide);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) {
            URL.revokeObjectURL(sourceUrl);
            return;
          }
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(sourceUrl);
          const outputBlob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.76),
          );
          if (!outputBlob) return;
          const imageId = `ID_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
          const relationshipId = nextRelationshipId++;
          const mediaId = nextMediaId++;
          files[`xl/media/image${mediaId}.jpeg`] = new Uint8Array(await outputBlob.arrayBuffer());
          cellImageRelationships.push(
            `<Relationship Id="rId${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${mediaId}.jpeg"/>`,
          );
          cellImageEntries.push(
            `<etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${nextCellImageId++}" name="${imageId}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1800000" cy="1800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic></etc:cellImage>`,
          );
          embeddedImageFormulaByProductId.set(product.id, `=DISPIMG("${imageId}",1)`);
        } catch {
          // Keep the supplied template image or a linked image formula as a fallback.
        }
      };
      await Promise.all(
        [...new Map(quoteItemsInOrder.map(({ product }) => [product.id, product])).values()]
          .map((product) => embedProductImage(product)),
      );
      if (cellImageEntries.length) {
        cellImagesXml = cellImagesXml.replace(
          /<\/etc:cellImages>\s*$/,
          `${cellImageEntries.join("")}</etc:cellImages>`,
        );
        cellImagesRelsXml = cellImagesRelsXml.replace(
          /<\/Relationships>\s*$/,
          `${cellImageRelationships.join("")}</Relationships>`,
        );
        files[cellImagesPath] = strToU8(cellImagesXml);
        files[cellImagesRelsPath] = strToU8(cellImagesRelsXml);
      }
      const currentProductImageFormula = (product: Product) => {
        const embeddedFormula = embeddedImageFormulaByProductId.get(product.id);
        if (embeddedFormula) return embeddedFormula;
        const templateFormula = templateImageFormulaBySku.get(product.sku.toUpperCase());
        if (templateFormula) return templateFormula;
        if (!product.image) return undefined;
        const sourceUrl = new URL(product.image, window.location.origin).toString();
        return `=IMAGE("${sourceUrl.replaceAll('"', '""')}","",1)`;
      };
      const canExportCost = ["admin", "ceo", "cost_accountant"].includes(authAccount?.role || "");
      const hiddenColumns = new Set<number>();

      let destinationRow = 4;
      const dynamicRows: string[] = [];
      const areaMerges: string[] = [];
      const revisionRows: Array<{row: number; product: Product}> = [];
      quoteGroups.forEach(([area, items]) => {
        if (destinationRow + items.length > 115)
          throw new Error("当前报价产品过多，超过该报价模板的 100 项容量");
        const areaLabel = splitBilingual(area);
        let areaRow = templateRow(areaPrototype, 4, destinationRow);
        areaRow = updateTemplateRowCell(
          areaRow,
          destinationRow,
          1,
          areaLabel.en
            ? `${areaLabel.zh} / ${areaLabel.en} · 区域小计 / Area Subtotal`
            : `${areaLabel.zh} · 区域小计 / Area Subtotal`,
        );
        areaMerges.push(`B${destinationRow}:N${destinationRow}`);
        areaMerges.push(`O${destinationRow}:R${destinationRow}`);
        destinationRow += 1;
        const firstItemRow = destinationRow;
        items.forEach((item, index) => {
          const { product, quantity } = item;
          const row = destinationRow + index;
          revisionRows.push({row, product});
          const unitPrice = displayPrice(product) || 0;
          const englishName = needsEnglishTranslation(product)
            ? ""
            : englishProductName(product);
          let productRow = templateRow(itemPrototype, 5, row);
          productRow = updateTemplateRowCell(productRow, row, 0, quoteItemsInOrder.indexOf(item) + 1);
          productRow = updateTemplateRowCell(productRow, row, 1, product.sku);
          productRow = updateTemplateRowCell(
            productRow,
            row,
            2,
            englishName ? `${product.name}\n${englishName}` : product.name,
          );
          const imageFormula = currentProductImageFormula(product);
          productRow = imageFormula
            ? updateTemplateRowTextFormula(productRow, row, 3, imageFormula)
            : updateTemplateRowCell(productRow, row, 3, "");
          productRow = updateTemplateRowCell(productRow, row, 4, product.brand || "YIFUN");
          productRow = updateTemplateRowCell(productRow, row, 5, product.spec || "");
          productRow = updateTemplateRowCell(productRow, row, 6, product.unit || "");
          productRow = updateTemplateRowCell(productRow, row, 7, quantity);
          const cost = canExportCost && Number.isFinite(product.cost)
            ? Number(product.cost)
            : null;
          productRow = updateTemplateRowCell(productRow, row, 8, cost ?? "");
          productRow = cost === null
            ? updateTemplateRowCell(productRow, row, 9, "")
            : updateTemplateRowFormula(productRow, row, 9, `=H${row}*I${row}`, cost * billableQuantity(product, quantity));
          productRow = updateTemplateRowCell(productRow, row, 10, priceMode === "factory" ? unitPrice : product.price ?? "");
          productRow = updateTemplateRowFormula(
            productRow,
            row,
            11,
            `=H${row}*K${row}`,
            (priceMode === "factory" ? unitPrice : product.price || 0) * billableQuantity(product, quantity),
          );
          productRow = updateTemplateRowCell(productRow, row, 12, product.usd ?? "");
          productRow = updateTemplateRowFormula(
            productRow,
            row,
            13,
            `=H${row}*M${row}`,
            (product.usd || 0) * billableQuantity(product, quantity),
          );
          productRow = updateTemplateRowCell(productRow, row, 14, "");
          productRow = updateTemplateRowCell(productRow, row, 15, product.note || "");
          productRow = updateTemplateRowCell(productRow, row, 16, product.material || "");
          productRow = updateTemplateRowCell(productRow, row, 17, product.volume || "");
          dynamicRows.push(productRow);
        });
        const lastItemRow = destinationRow + items.length - 1;
        const areaTotal = items.reduce((sum, item) => sum + (item.product.usd || 0) * billableQuantity(item.product, item.quantity), 0);
        areaRow = updateTemplateRowFormula(
          areaRow,
          firstItemRow - 1,
          14,
          `=SUM(N${firstItemRow}:N${lastItemRow})`,
          areaTotal,
        );
        dynamicRows.push(areaRow);
        const areaRowIndex = dynamicRows.length - items.length - 1;
        dynamicRows.splice(areaRowIndex, 0, dynamicRows.pop()!);
        destinationRow = lastItemRow + 1;
      });

      const preservedRows = [...sourceRows.entries()]
        .filter(([row]) => row < 4 || row >= 116)
        .sort(([left], [right]) => left - right)
        .map(([, row]) => row);
      xml = xml.replace(
        /<sheetData[^>]*>[\s\S]*?<\/sheetData>/,
        `<sheetData>${[...preservedRows.slice(0, 3), ...dynamicRows, ...preservedRows.slice(3)].join("")}</sheetData>`,
      );
      const mergedCells = [...xml.matchAll(/<mergeCell\s+ref="([^"]+)"\/>/g)]
        .map((match) => match[1])
        .filter((ref) => !/^B\d+:S\d+$/.test(ref) && XLSX.utils.decode_col(ref.match(/^[A-Z]+/)![0]) < 18 && ref !== "A1:P2");
      xml = xml.replace(
        /<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/,
        `<mergeCells count="${mergedCells.length + areaMerges.length + 3}">${[
          ...mergedCells,
          ...areaMerges, "A1:O2", "P1:Q1", "P2:Q2",
        ].map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`,
      );
      xml = xml.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:R125"/>');
      xml = setTemplateHiddenColumns(xml, hiddenColumns);

      const setCell = (row: number, column: number, value: string | number) => {
        xml = updateTemplateCell(xml, XLSX.utils.encode_cell({ r: row - 1, c: column }), value);
      };
      const setFormula = (row: number, column: number, formula: string, value: number) => {
        xml = updateTemplateFormula(xml, XLSX.utils.encode_cell({ r: row - 1, c: column }), formula, value);
      };
      for (const [code, column] of [["CNY", 11], ["USD", 13]] as const) {
        const selected = code === currency;
        const sum = quoteItemsInOrder.reduce((total, item) => total + (code === "USD" ? item.product.usd || 0 : priceMode === "factory" ? displayPrice(item.product) || 0 : item.product.price || 0) * billableQuantity(item.product, item.quantity), 0);
        const extra = selected ? fees : {packaging: 0, formaldehyde: 0, shipping: 0, installation: 0, designDeduction: 0};
        const totals = quotationTotals(sum, code, extra, selected && includeTax, selected && showDesignDeduction);
        const letter = XLSX.utils.encode_col(column);
        [extra.packaging, extra.formaldehyde, extra.shipping, extra.installation].forEach((value, index) => setCell(116 + index, column, value));
        setFormula(120, column, `=SUM(${letter}4:${letter}119)`, totals.preTax);
        setFormula(121, column, code === "CNY" && selected && includeTax ? `=${letter}120*13%` : "=0", totals.tax);
        setFormula(122, column, `=${letter}120+${letter}121-${selected && showDesignDeduction ? fees.designDeduction : 0}`, totals.totalWithTax);
      }
      const selectedTotal = totalWithTax;
      setCell(1, 0, `YIFUN LIFE+${quoteProject.trim() || "PROJECT"}+QUOTATION`);
      setCell(1, 15, "设计师 / Designer");
      setCell(1, 16, "");
      setCell(1, 17, "商务 / Sales");
      setCell(2, 15, designerName);
      setCell(2, 16, "");
      setCell(2, 17, salesName);
      importedQuoteHeaders.forEach((lines, column) => setCell(3, column, lines.join("\n")));
      setCell(123, 2, `${currency} ${new Intl.NumberFormat(currency === "USD" ? "en-US" : "zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(selectedTotal)}`);
      xml = xml.replace(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g, cell => {
        const ref = cell.match(/\br="([A-Z]+)\d+"/)?.[1];
        return ref && XLSX.utils.decode_col(ref) >= 18 ? "" : cell;
      }).replace(/<col\b([^>]*)\/>/g, (tag, attrs: string) => {
        const min = Number(attrs.match(/\bmin="(\d+)"/)?.[1]);
        return min > 18 ? "" : tag.replace(/\bmax="(\d+)"/, (_, max) => `max="${Math.min(18, Number(max))}"`);
      }).replace(/(<mergeCell\s+ref="[A-Z]+\d+:)([A-Z]+)(\d+"\/>)/g, (_, start, column, end) => `${start}${XLSX.utils.decode_col(column) >= 18 ? "R" : column}${end}`);
      xml = formatQuoteCurrencyCells(files, xml, 3, [8, 9, 10, 11]);
      files[worksheetPath] = strToU8(normalizeTemplateCellOrder(xml));
      applyQuoteRevisions(files, worksheetPath, revisionRows);
      downloadExcelFile(new Uint8Array(await translateQuoteWorkbook(zipSync(files, { level: 6 }).buffer as ArrayBuffer)), `${quoteExportFileName()}.xlsx`);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "导出 Excel 失败，请重新打开报价单后再试。",
      );
    }
  };
  const exportQuotePdf = async (saveHistory = true) => {
    if (!checkCostedQuote()) return;
    if (saveHistory && !(await recordQuoteHistory())) return;
    try {
      const pageWidth = 2384;
      const pageHeight = 1684;
      const left = 48;
      const tableWidth = 2288;
      const columns = [64, 164, 340, 170, 140, 170, 92, 75, 190, 190, 115, 115, 463];
      const headers = [
        "序号 / No.", "款号 / SKU", "产品名称 / Product", "图片展示 / Image",
        "玩具品牌 / Brand", "规格尺寸 / Size", "单位 / Unit", "数量 / Qty",
        `${currency} 单价 / Unit price`, `${currency} 金额 / Amount`, "色卡编号 / Colour",
        "体积 / Volume", "备注 / Remarks",
      ];
      const font = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
      const loadImage = (sourceUrl: string) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const source = new Image();
          source.onload = () => resolve(source);
          source.onerror = () => resolve(null);
          source.src = sourceUrl;
        });
      const logo = await loadImage("/brand/yifun-life-logo.png?v=bb45e13732b7");
      const images = new Map<string, HTMLImageElement | null>();
      const uniqueProducts = [...new Map(quoteItemsInOrder.map(({ product }) => [product.id, product])).values()];
      await Promise.all(uniqueProducts.map(async (product) => {
        const sourceUrls = [
          product.image,
          product.sku
            ? `/api/catalog/image?key=${encodeURIComponent(`quote-imports/mdo/${skuImageKey(product.sku)}`)}`
            : "",
        ].filter(Boolean);
        let image: HTMLImageElement | null = null;
        for (const imageUrl of sourceUrls) {
          image = await loadImage(imageUrl);
          if (image) break;
        }
        images.set(product.id, image);
      }));

      const pages: Uint8Array[] = [];
      let canvas = document.createElement("canvas");
      let context: CanvasRenderingContext2D | null = null;
      let y = 0;
      let pageNumber = 0;
      const tableTop = 184;
      const contentBottom = pageHeight - 104;
      const textLines = (value: string, width: number, maxLines = 3) => {
        const words = String(value || "—").split(/(?=[\u4e00-\u9fff])|\s+/).filter(Boolean);
        const lines: string[] = [];
        let line = "";
        words.forEach((word) => {
          const next = line ? `${line}${/^[\u4e00-\u9fff]/.test(word) ? "" : " "}${word}` : word;
          if (context!.measureText(next).width > width && line) {
            lines.push(line);
            line = word;
          } else line = next;
        });
        if (line) lines.push(line);
        if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].slice(0, 18)}…`];
        return lines.length ? lines : ["—"];
      };
      const drawLines = (value: string, x: number, top: number, width: number, lineHeight: number, maxLines = 3, align: CanvasTextAlign = "left") => {
        const lines = textLines(value, width, maxLines);
        context!.textAlign = align;
        lines.forEach((line, index) => context!.fillText(line, x, top + lineHeight * index));
        return lines.length;
      };
      const canvasToJpeg = async () => {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
        if (!blob) throw new Error("PDF 页面生成失败");
        pages.push(new Uint8Array(await blob.arrayBuffer()));
      };
      const startPage = () => {
        pageNumber += 1;
        canvas = document.createElement("canvas");
        canvas.width = pageWidth;
        canvas.height = pageHeight;
        context = canvas.getContext("2d");
        if (!context) throw new Error("PDF 页面生成失败");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, pageWidth, pageHeight);
        if (logo && logo.naturalWidth && logo.naturalHeight) {
          const logoWidth = 440;
          const logoHeight = logoWidth * (logo.naturalHeight / logo.naturalWidth);
          context.drawImage(logo, left, 44, logoWidth, logoHeight);
        }
        context.textAlign = "right";
        context.fillStyle = "#c4b421";
        context.font = `700 19px ${font}`;
        context.fillText(`QUOTATION · ${currency}`, left + tableWidth, 54);
        context.fillStyle = "#08477e";
        context.font = `700 52px ${font}`;
        context.fillText("产品报价清单 / Product Quotation", left + tableWidth, 130);
        context.fillRect(left, 150, tableWidth, 7);
        context.fillStyle = "#08477e";
        context.fillRect(left, tableTop, tableWidth, 82);
        context.fillStyle = "#ffffff";
        context.font = `700 20px ${font}`;
        let x = left;
        headers.forEach((header, index) => {
          context!.textAlign = "center";
          const [first, second] = header.split(" / ");
          context!.fillText(first, x + columns[index] / 2, tableTop + 33);
          context!.font = `600 15px ${font}`;
          context!.fillText(second || "", x + columns[index] / 2, tableTop + 60);
          context!.font = `700 20px ${font}`;
          x += columns[index];
        });
        context!.fillStyle = "#cfd9d5";
        context!.fillRect(left, pageHeight - 72, tableWidth, 2);
        context!.fillStyle = "#5c6c72";
        context!.font = `600 17px ${font}`;
        context!.textAlign = "right";
        context!.fillText(`第 ${pageNumber} 页 / Page ${pageNumber}`, left + tableWidth, pageHeight - 40);
        y = tableTop + 82;
      };
      const startNewPage = async () => {
        if (context) await canvasToJpeg();
        startPage();
      };
      const fillGroup = (area: string) => {
        context!.fillStyle = "#e2eddc";
        context!.fillRect(left, y, tableWidth, 48);
        context!.fillStyle = "#315d45";
        context!.font = `700 25px ${font}`;
        context!.textAlign = "left";
        context!.fillText(area, left + 18, y + 32);
        y += 48;
      };
      const drawGroupSubtotal = (items: (typeof quoteItemsInOrder)[number][]) => {
        const subtotal = quoteAreaSubtotal(items);
        context!.fillStyle = "#f3f7f0";
        context!.fillRect(left, y, tableWidth, 52);
        context!.strokeStyle = "#c8d7c4";
        context!.lineWidth = 1;
        context!.strokeRect(left, y, tableWidth, 52);
        context!.fillStyle = "#315d45";
        context!.font = `700 21px ${font}`;
        context!.textAlign = "right";
        context!.fillText(
          `区域小计 / Area subtotal: ${money(subtotal, currency)}`,
          left + tableWidth - 18,
          y + 33,
        );
        y += 52;
      };
      const drawItem = (item: (typeof quoteItemsInOrder)[number], serial: number) => {
        const { product, quantity } = item;
        const unitPrice = displayPrice(product);
        const amount = unitPrice === null ? null : unitPrice * quantity;
        const rowHeight = 122;
        context!.fillStyle = serial % 2 ? "#ffffff" : "#fbfcfa";
        context!.fillRect(left, y, tableWidth, rowHeight);
        context!.strokeStyle = "#d8e0dc";
        context!.lineWidth = 1;
        context!.beginPath();
        context!.moveTo(left, y + rowHeight);
        context!.lineTo(left + tableWidth, y + rowHeight);
        let x = left;
        columns.forEach((width) => {
          context!.moveTo(x, y);
          context!.lineTo(x, y + rowHeight);
          x += width;
        });
        context!.lineTo(left + tableWidth, y);
        context!.stroke();
        const cell = (index: number) => left + columns.slice(0, index).reduce((sum, width) => sum + width, 0);
        context!.fillStyle = "#1f2e3d";
        context!.font = `600 18px ${font}`;
        context!.textBaseline = "middle";
        drawLines(String(serial), cell(0) + columns[0] / 2, y + 60, columns[0] - 12, 22, 1, "center");
        drawLines(product.sku || "—", cell(1) + 10, y + 38, columns[1] - 20, 23, 2);
        context!.font = `700 20px ${font}`;
        drawLines(product.name, cell(2) + 10, y + 28, columns[2] - 20, 24, 2);
        context!.fillStyle = "#84919a";
        context!.font = `500 15px ${font}`;
        drawLines(needsEnglishTranslation(product) ? "" : englishProductName(product), cell(2) + 10, y + 88, columns[2] - 20, 18, 1);
        const image = images.get(product.id);
        const imageX = cell(3) + 16;
        const imageY = y + 14;
        const imageWidth = columns[3] - 32;
        const imageHeight = rowHeight - 28;
        context!.fillStyle = "#f1f3ef";
        context!.fillRect(imageX, imageY, imageWidth, imageHeight);
        if (image && image.naturalWidth && image.naturalHeight) {
          const scale = Math.min(imageWidth / image.naturalWidth, imageHeight / image.naturalHeight);
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          context!.drawImage(image, imageX + (imageWidth - width) / 2, imageY + (imageHeight - height) / 2, width, height);
        } else {
          context!.fillStyle = "#7a878d";
          context!.font = `500 15px ${font}`;
          drawLines("暂无图片", imageX + imageWidth / 2, y + 61, imageWidth - 8, 18, 1, "center");
        }
        const values = [
          product.brand || "YIFUN", product.spec || "—", unitLabel(product.unit).zh || product.unit || "—",
          String(quantity), money(unitPrice, currency), money(amount, currency), colourLabel(product.colorTag).zh || "—",
          product.volume || "—", product.note || "—",
        ];
        const indices = [4, 5, 6, 7, 8, 9, 10, 11, 12];
        values.forEach((value, position) => {
          const index = indices[position];
          context!.fillStyle = index === 8 || index === 9 ? "#08477e" : "#31404b";
          context!.font = `${index === 8 || index === 9 ? "700" : "500"} ${index === 12 ? 16 : 17}px ${font}`;
          const centered = [6, 7, 10, 11].includes(index);
          drawLines(value, centered ? cell(index) + columns[index] / 2 : cell(index) + 9, y + 38, columns[index] - 18, 22, index === 12 ? 3 : 2, centered ? "center" : "left");
        });
        y += rowHeight;
      };

      startPage();
      let serial = 1;
      for (const [area, items] of quoteGroups) {
        if (y + 48 + 122 + 52 > contentBottom) await startNewPage();
        fillGroup(area);
        for (const [index, item] of items.entries()) {
          const needsSubtotal = index === items.length - 1;
          if (y + 122 + (needsSubtotal ? 52 : 0) > contentBottom)
            await startNewPage();
          drawItem(item, serial++);
        }
        drawGroupSubtotal(items);
      }
      if (y + 74 > contentBottom) await startNewPage();
      context!.fillStyle = "#08477e";
      context!.font = `700 28px ${font}`;
      context!.textAlign = "right";
      context!.fillText(`报价总额 / Total: ${money(totalWithTax, currency)}`, left + tableWidth, y + 48);
      await canvasToJpeg();

      const encoder = new TextEncoder();
      const pieces: Uint8Array[] = [];
      const offsets: number[] = [];
      let size = 0;
      const append = (value: string | Uint8Array) => {
        const bytes = typeof value === "string" ? encoder.encode(value) : value;
        pieces.push(bytes);
        size += bytes.byteLength;
      };
      const object = (id: number, body: string | Uint8Array) => {
        offsets[id] = size;
        append(`${id} 0 obj\n`);
        append(body);
        append("\nendobj\n");
      };
      const objectCount = 2 + pages.length * 3;
      append("%PDF-1.4\n");
      object(1, "<< /Type /Catalog /Pages 2 0 R >>");
      const pageIds = pages.map((_, index) => 3 + index * 3);
      object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
      pages.forEach((image, index) => {
        const pageId = 3 + index * 3;
        const imageId = pageId + 1;
        const contentId = pageId + 2;
        object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190.55 841.89] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
        offsets[imageId] = size;
        append(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pageWidth} /Height ${pageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.byteLength} >>\nstream\n`);
        append(image);
        append("\nendstream\nendobj\n");
        const stream = `q\n1190.55 0 0 841.89 0 0 cm\n/Im${index} Do\nQ\n`;
        object(contentId, `<< /Length ${encoder.encode(stream).byteLength} >>\nstream\n${stream}endstream`);
      });
      const xref = size;
      append(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
      for (let id = 1; id <= objectCount; id += 1)
        append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
      append(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
      const pdf = new Blob(pieces.map((piece) => new Uint8Array(piece).buffer), { type: "application/pdf" });
      const url = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${quoteExportFileName()}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "导出 PDF 失败，请重新打开报价单后再试。");
    }
  };
  useEffect(() => {
    if (!pendingHistoryExport || !quoteOpen) return;
    const format = pendingHistoryExport;
    const timer = window.setTimeout(() => {
      setPendingHistoryExport(null);
      void (format === "pdf" ? exportQuotePdf(false) : exportQuoteExcel(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingHistoryExport, quoteOpen]);
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
    if (!isAdmin) return;
    setEditor(p);
    setDraft(p);
    setTagDraftText(p.tags.join("、"));
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
    const normalizedTags = [...new Set(
      tagDraftText.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean),
    )];
    if (normalizedTags.includes("主设备") && !draft.spec.trim()) {
      window.alert("主设备必须填写尺寸后才能保存。");
      return;
    }
    if (!draft.classifications.length || draft.classifications.some(
      (record) => !record.level1.trim() || !record.level2.trim() || !record.level3.trim(),
    )) {
      window.alert("每一条分类记录都必须完整填写 1、2、3级分类。");
      return;
    }
    const primaryClassification = draft.classifications[0];
    const primaryTag = normalizedTags[0] || "";
    const colorTag =
      isSpaceTheme(draft.name, draft.en)
        ? "银色"
        : primaryClassification.level2 === "模拟设备" && primaryClassification.level3 === "消防区设备"
        ? "红"
        : normalizeColorTag(draft.colorTag);
    const patch = {
      name: draft.name,
      price: draft.price === null ? "" : String(draft.price),
      imageUrl: draft.image,
      volume: draft.volume,
      specification: draft.spec,
      unit: draft.unit,
      cost: draft.cost,
      branchPrice: draft.branchPrice,
      supplyMethod: draft.supplyMethod,
      stock: draft.stock,
      majorCategory: primaryClassification.level1 as MajorCategory,
      category1: primaryClassification.level2,
      category2: primaryClassification.level3,
      category3: primaryTag,
      colorTag,
      hasScreen: draft.hasScreen,
      isRecommended: draft.isRecommended,
    };
    const previousFields = { ...editor, imageUrl: editor?.image, specification: editor?.spec, price: editor?.price === null ? "" : String(editor?.price) };
    const changedPatch = Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== previousFields[key as keyof typeof previousFields]));
    const relatedProducts = draft.relatedIds.map((relatedProductId) => ({ relatedProductId, quantity: relations.find((relation) => relation.productId === draft.id && relation.relatedProductId === relatedProductId)?.quantity || 1 }));
    let classificationResult: { classifications?: ProductClassification[]; tags?: string[] };
    try {
      const response = await fetch("/api/catalog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: draft.id, patch: changedPatch, editedFields: Object.keys(changedPatch), classifications: draft.classifications, tags: normalizedTags, relatedProducts }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      classificationResult = result;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "保存失败，请检查网络后重试。");
      return;
    }
    setOverrides((x) => [
      ...x.filter((o) => o.productId !== draft.id),
      { productId: draft.id, ...patch },
    ]);
    setProductClassifications((current) => [
      ...current.filter((record) => record.productId !== draft.id),
      ...(classificationResult.classifications || []),
    ]);
    setProductTags((current) => [
      ...current.filter((record) => record.productId !== draft.id),
      ...(classificationResult.tags || []).map((tag: string) => ({ productId: draft.id, tag })),
    ]);
    setRelations((x) => [
      ...x.filter((r) => r.productId !== draft.id),
      ...relatedProducts.map((relation) => ({ productId: draft.id, ...relation })),
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
          setDraft((x) =>
            x
              ? {
                  ...x,
                  image: d.imageUrl,
                  colorTag: isSpaceTheme(x.name, x.en)
                    ? "银色"
                    : x.category2 === "消防区设备"
                      ? "红"
                      : colorTag,
                }
              : x,
          ),
        );
    }
  };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");
    setLoginNotice("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: loginUsername,
        password: loginPassword,
      }),
    });
    if (r.ok) {
      const d = await r.json();
      setLoginPassword("");
      if (d.mustChangePassword) { window.location.replace("/profile"); return; }
      if (d.role === "ceo") {
        window.location.replace("/ceo-dashboard");
        return;
      }
      setAuthAccount({ email: d.email, name: d.name, role: d.role, expiresAt: d.expiresAt });
      setAuth("signedIn");
    } else {
      const d = await r.json().catch(() => ({}));
      setLoginError(d.error || "登录失败，请重试");
    }
  };
  const register = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");
    setLoginNotice("");
    if (loginPassword !== loginPasswordConfirm) {
      setLoginError("两次输入的密码不一致。");
      return;
    }
    const r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: loginName, email: loginUsername, password: loginPassword }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setLoginError(d.error || "注册失败，请重试");
      return;
    }
    setLoginNotice(d.message || "注册成功，等待管理员批准后即可使用。");
    setLoginPassword("");
    setLoginPasswordConfirm("");
    setAuthMode("login");
  };
  const requestPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");
    const r = await fetch("/api/auth/request-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginUsername }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setLoginError(d.error || "发送重设链接失败，请稍后重试。");
      return;
    }
    setLoginNotice(d.message || "如该邮箱已获批准，重设密码链接将发送至邮箱。");
  };
  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError("");
    if (loginPassword !== loginPasswordConfirm) {
      setLoginError("两次输入的密码不一致。");
      return;
    }
    const token = new URLSearchParams(window.location.search).get("reset");
    const r = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: loginPassword }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setLoginError(d.error || "密码重设失败，请重试");
      return;
    }
    window.history.replaceState({}, "", "/");
    setLoginPassword("");
    setLoginPasswordConfirm("");
    setLoginNotice(d.message || "密码已更新，请使用新密码登录。");
    setAuthMode("login");
  };
  const openStaff = () => window.location.assign("/personnel");
  useEffect(() => {
    if (auth !== "signedIn" || authAccount?.role !== "admin") return;
    void fetch("/api/admin/users").then(response => response.json()).then(data => {
      setPendingStaffCount((data.users || []).filter((user: { status: string }) => user.status === "pending").length);
    }).catch(() => {});
  }, [auth, authAccount?.role]);
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  };
  if (auth === "checking")
    return (
      <main className="loginShell">
        <div className="loginCard">
          <a className="loginBrand" href="/" aria-label="返回主页">
            <CompanyLogo className="loginLogo" />
          </a>
          <p>正在验证访问权限…</p>
        </div>
      </main>
    );
  if (auth === "signedOut") {
    const isRegister = authMode === "register";
    const isForgot = authMode === "forgot";
    const isReset = authMode === "reset";
    const submit = isRegister ? register : isForgot ? requestPasswordReset : isReset ? resetPassword : login;
    const title = isRegister ? "注册员工账号" : isForgot ? "找回密码" : isReset ? "设置新密码" : "登录产品报价系统";
    const description = isRegister
      ? "提交后由唯一管理员批准，批准前不能登录。"
      : isForgot
        ? "输入已绑定并验证的邮箱，我们会发送 30 分钟内有效的重设链接。"
        : isReset
          ? "请设置至少 6 位的新密码。"
          : "请输入用户名与密码后继续。";
    return (
      <main className="loginShell">
        <form className="loginCard" onSubmit={submit}>
          <a className="loginBrand" href="/" aria-label="返回主页">
            <CompanyLogo className="loginLogo" />
          </a>
          <span className="eyebrow">PRIVATE ACCESS</span>
          <h1>{title}</h1>
          <p>{description}</p>
          {isRegister && <label>姓名 / Name<input value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="name" required /></label>}
          {!isReset && <label>{isForgot ? "邮箱 / Email" : "用户名 / Username"}<input type={isForgot ? "email" : "text"} value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} autoComplete={isForgot ? "email" : "username"} required /></label>}
          {!isForgot && <PasswordField key={authMode} id="login-password" label="密码 / Password" value={loginPassword} onChange={setLoginPassword} autoComplete={isReset || isRegister ? "new-password" : "current-password"} required />}
          {(isRegister || isReset) && <PasswordField id="confirm-password" label="确认密码 / Confirm password" value={loginPasswordConfirm} onChange={setLoginPasswordConfirm} autoComplete="new-password" required />}
          {loginError && <div className="loginError">{loginError}</div>}
          {loginNotice && <div className="loginNotice">{loginNotice}</div>}
          <button className="primary" type="submit">{isRegister ? "提交注册 / Register" : isForgot ? "发送重设链接 / Send link" : isReset ? "更新密码 / Update password" : "登录 / Sign in"}</button>
          {!isReset && <div className="loginLinks">
            {authMode !== "login" && <button type="button" onClick={() => { setAuthMode("login"); setLoginError(""); }}>返回登录</button>}
            {authMode === "login" && <><button type="button" onClick={() => { setAuthMode("forgot"); setLoginUsername(""); setLoginPassword(""); setLoginError(""); setLoginNotice(""); }}>忘记密码？</button><small>账号开通请联系管理员或 CEO。</small></>}
          </div>}
          <small className="loginHint">为保护报价信息，登录 30 分钟后将自动退出。</small>
        </form>
      </main>
    );
  }
  const hospitalPairingSource = pairingSuggestion?.source.category2 === "医院区";
  const optionalPairingItems =
    pairingSuggestion?.relatedItems.filter((item) => !item.isBound) || [];
  const selectedOptionalPairingCount = optionalPairingItems.filter(
    (item) => item.quantity > 0,
  ).length;
  const allOptionalPairingItemsSelected =
    optionalPairingItems.length > 0 &&
    selectedOptionalPairingCount === optionalPairingItems.length;
  const pairingDialogItems = (
    items: PairingSuggestion["relatedItems"],
    emptyText: string,
  ) =>
    items.length ? (
      items.map(({ product, quantity, isBound }) => (
        <article className="pairingDialogItem" key={product.id}>
          <div className="pairingDialogImage"><Visual p={product} mini /></div>
          <div className="pairingDialogInfo">
            <div className="pairingDialogNamePrice">
              <b title={product.name}>{product.name}</b>
              <span className="pairingDialogPrice">单价 {money(displayPrice(product), currency)}</span>
            </div>
            <small className={needsEnglishTranslation(product) ? "missingEnglish" : ""}>{englishProductName(product)}</small>
            <small>SKU: {product.sku}</small>
          </div>
          {!isBound || pairingSuggestion?.mode === "cart" ? (
            <label className="pairingDialogSelect">
              <input
                aria-label={`选择 ${product.sku}`}
                checked={quantity > 0}
                onChange={(event) =>
                  setOptionalPairingSelection(product.id, event.target.checked)
                }
                type="checkbox"
              />
              <span>{isBound ? "已选" : "选择"}</span>
            </label>
          ) : (
            <span className="pairingDialogSelectSpacer" aria-hidden="true" />
          )}
          <div className="pairingDialogQty">
            <span>数量</span>
            <div className="pairingDialogQuantityControl">
              <button
                aria-label={`减少 ${product.sku} 数量`}
                disabled={quantity <= 0}
                onClick={() => setSuggestedPairingQuantity(product.id, quantity - 1)}
                type="button"
              >
                −
              </button>
              <input
                aria-label={`${product.sku} 数量`}
                inputMode="numeric"
                pattern="[0-9]*"
                type="text"
                value={quantity || ""}
                onChange={(event) => {
                  const value = event.target.value;
                  if (/^\d*$/.test(value))
                    setSuggestedPairingQuantity(product.id, Number(value || 0));
                }}
              />
              <button
                aria-label={`增加 ${product.sku} 数量`}
                onClick={() => setSuggestedPairingQuantity(product.id, quantity + 1)}
                type="button"
              >
                ＋
              </button>
            </div>
          </div>
        </article>
      ))
    ) : (
      <p className="pairingDialogSectionEmpty">{emptyText}</p>
    );
  const toggleHospitalPairingGroup = (group: HospitalPairingGroup) =>
    setCollapsedHospitalPairingGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="返回主页">
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
          <select
            className="currency"
            value={priceMode}
            onChange={(event) => requestPriceModeChange(event.target.value as PriceMode)}
            aria-label="选择报价货币"
          >
            <option value="factory">出厂价（CNY）</option>
            <option value="vip">连锁品牌价（CNY）</option>
            <option value="usd">美金价格（USD）</option>
          </select>
          {isAdmin && (
            <button
              className="outline"
              onClick={() => window.open("/product-pairing", "_blank", "noopener")}
            >
              玩具配对管理
            </button>
          )}
          <button
            className="outline"
            onClick={() => {
              setQuoteImportOpen(true);
              setQuoteImportError("");
              setQuoteImportPreview(null);
            }}
          >
            导入清单
          </button>
          <button className="outline" onClick={openToyMatchingWorkspace} type="button">
            玩具匹配{toyMatchingDraftId ? " · 未完成" : ""}
          </button>
          <button className="cartButton" onClick={() => setCartOpen(true)}>
            <span>报价清单</span>
            <b>{cartItems.length}</b>
          </button>
          <button
            className="employeeButton"
            onClick={() => setEmployeeMenuOpen((current) => !current)}
            data-employee-menu-surface
            aria-label="员工账户菜单"
            aria-expanded={employeeMenuOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4.5 20c.7-4 3.2-6 7.5-6s6.8 2 7.5 6" />
            </svg>
            {authAccount?.role === "admin" && pendingStaffCount > 0 && (
              <b className="employeeApprovalBadge">{pendingStaffCount}</b>
            )}
          </button>
        </div>
      </header>
      <nav className="mobileQuickNav" aria-label="手机快捷导航">
        <button type="button" aria-expanded={mobileCategoriesOpen} aria-controls="product-categories" onClick={() => { setEmployeeMenuOpen(false); setMobileCategoriesOpen(value => !value); }}>分类</button>
        <button type="button" onClick={() => { setMobileCategoriesOpen(false); setQuoteImportError(""); setQuoteImportPreview(null); setQuoteImportOpen(true); }}>导入清单</button>
        <button type="button" onClick={() => { setMobileCategoriesOpen(false); setCartOpen(true); }}>报价清单 <b>{cartItems.length}</b></button>
        <button type="button" data-employee-menu-surface aria-expanded={employeeMenuOpen} onClick={() => { setMobileCategoriesOpen(false); setEmployeeMenuOpen(value => !value); }}>更多</button>
      </nav>
      {authAccount?.role === "admin" && pendingStaffCount > 0 && (
        <aside className="staffApprovalNotice" aria-live="polite">
          <div>
            <span>ACCOUNT APPROVAL</span>
            <b>有 {pendingStaffCount} 位员工等待批准</b>
            <small>新注册账号需由管理员批准后才能进入系统。</small>
          </div>
          <button
            className="primary smallPrimary"
            onClick={() => void openStaff()}
          >
            立即处理
          </button>
        </aside>
      )}
      {employeeMenuOpen && (
        <aside
          className="employeeMenu"
          role="menu"
          aria-label="员工账户菜单"
          data-employee-menu-surface
        >
          <button role="menuitem" onClick={() => { setEmployeeMenuOpen(false); window.location.assign("/profile"); }}>个人资料 / 修改密码</button>
          <div className="employeeMenuAccount">
            <span>当前账号 / ACCOUNT</span>
            <b>{authAccount?.name || "员工"}</b>
            <small>{authAccount?.email}</small>
            <small>{authAccount?.role === "admin" ? "管理员 / Administrator" : authAccount?.role === "ceo" ? "CEO（可查看全部信息并导出成本）" : authAccount?.role === "management" ? "管理层 / Management（可查看全部信息并使用系统）" : authAccount?.role === "cost_accountant" ? "核算人员 / Cost accountant" : "员工 / Employee"}</small>
          </div>
          <button className="mobileMenuAction" role="menuitem" onClick={() => { setEmployeeMenuOpen(false); openToyMatchingWorkspace(); }}>玩具匹配</button>
          {isAdmin && <button className="mobileMenuAction" role="menuitem" onClick={() => { setEmployeeMenuOpen(false); window.open("/product-pairing", "_blank", "noopener"); }}>玩具配对管理</button>}
          <button
            role="menuitem"
            onClick={() => {
              setEmployeeMenuOpen(false);
              window.location.assign("/quotation-history");
            }}
          >
            历史报价单
          </button>
          <button role="menuitem" onClick={() => { setEmployeeMenuOpen(false); window.location.assign("/trade-documents"); }}>PI / CI / 设备合同 · PDF 邮件</button>
          {(authAccount?.role === "admin" || authAccount?.role === "ceo" || authAccount?.role === "management") && (
            <button
              role="menuitem"
              onClick={() => {
                setEmployeeMenuOpen(false);
                window.location.assign("/ceo-dashboard");
              }}
            >
              CEO 看板
            </button>
          )}
          {["admin", "ceo", "cost_accountant"].includes(authAccount?.role || "") && <button role="menuitem" onClick={() => window.location.assign("/costing")}>核算管理</button>}
          {canViewStaff && (
            <button
              role="menuitem"
              onClick={() => {
                setEmployeeMenuOpen(false);
                void openStaff();
              }}
            >
              人员及权限
            </button>
          )}
          <button
            className="employeeLogout"
            role="menuitem"
            onClick={() => {
              setEmployeeMenuOpen(false);
              setLogoutConfirmOpen(true);
            }}
          >
            退出系统
          </button>
        </aside>
      )}
      {logoutConfirmOpen && (
        <div
          className="logoutOverlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
          aria-describedby="logout-confirm-description"
        >
          <section className="logoutConfirm">
            <h2 id="logout-confirm-title">确认退出？</h2>
            <p id="logout-confirm-description">
              退出后将返回登录页面。
            </p>
            <div className="logoutConfirmActions">
              <button className="outline" onClick={() => setLogoutConfirmOpen(false)}>
                取消
              </button>
              <button
                className="primary"
                onClick={() => {
                  setLogoutConfirmOpen(false);
                  void logout();
                }}
              >
                确认退出
              </button>
            </div>
          </section>
        </div>
      )}
      <section className={`workspace${editor ? " editorOpen" : ""}`}>
        <aside id="product-categories" className={`sidebar${mobileCategoriesOpen ? " mobileCategoriesOpen" : ""}`}>
          <div className="mobileCategoryHeading"><b>产品分类</b><button type="button" onClick={() => setMobileCategoriesOpen(false)}>完成选择</button></div>
          <div className="sideIntro">
            <span>PRODUCT LIBRARY · 2026</span>
            <h1>
              产品库
              <br />
              与方案编辑
            </h1>
            <p>
              九大类为一级目录；点击任意 SKU
              可维护主图、价格、分类、标签和常用搭配。
            </p>
            {toyTierSyncStatus && (
              <p className="syncStatus">{toyTierSyncStatus}</p>
            )}
            {pairedAreaSyncStatus && (
              <p className="syncStatus">{pairedAreaSyncStatus}</p>
            )}
          </div>
          <nav>
            {navigationMajors.map((major, i) => {
              const expanded = expandedMajors.has(major);
              const isSeniorMajor = major === "大童类 / Older Children";
              const isRetailMajor = major === "零售（游玩必备） / Retail";
              const retailProducts = productViews.filter((product) =>
                navigationMajorMembers(major).includes(product.majorCategory),
              );
              const retailTypes = [...new Set(
                retailProducts.map((product) => product.category2).filter(Boolean),
              )];
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
                      setQuery("");
                      setCategory("全部产品");
                      setCategory3Filter("");
                      setSelectedCategoryKey("");
                      setNavigationGroup(isRetailMajor || isSeniorMajor ? "all" : "simulation");
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
                        : majorCategoryDisplayName(major).split(" / ")[0]}
                    </b>
                    <small>
                      {major === "农牧生活 / 动物世界"
                        ? "Agro-pastoral Life · Animal World"
                        : majorCategoryDisplayName(major).split(" / ")[1]} ·{" "}
                      {
                        productViews.filter((p) =>
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
                    {isSeniorMajor ? (
                      ["拓展迷宫", "滑梯"].map((group) => {
                        const groupProducts = retailProducts.filter((p) => p.category1 === group);
                        const sheets = [...new Set(groupProducts.map((p) => p.category2))];
                        const sectionKey = `${major}:${group}`;
                        const sectionExpanded = expandedProductGroups.has(sectionKey);
                        return (
                          <div className="subnavGroup" key={group}>
                            <div className={selectedCategoryKey === `senior:${group}` && category === "全部产品" ? "subnavGroupHead on" : "subnavGroupHead"}>
                            <button
                              className="subnavGroupSelect"
                              onClick={() => {
                                setActiveMajor(major);
                                setQuery("");
                                setCategory("全部产品");
                                setCategory3Filter("");
                                setSelectedCategoryKey(`senior:${group}`);
                                setNavigationGroup("all");
                              }}
                            >
                              <b>{group}</b><span>{groupProducts.length}</span>
                            </button>
                            <button
                              className="subnavGroupToggle"
                              aria-label={`${sectionExpanded ? "收起" : "展开"}${group}`}
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
                            </div>
                              {sectionExpanded && sheets.map((sheet) => (
                                <button
                                  key={sheet}
                                  className={selectedCategoryKey === `senior:${group}` && category === sheet ? "on" : ""}
                                  onClick={() => {
                                    setActiveMajor(major);
                                    setQuery("");
                                    setCategory(sheet);
                                    setCategory3Filter("");
                                    setSelectedCategoryKey(`senior:${group}`);
                                    setNavigationGroup("all");
                                  }}
                                >
                                  {sheet}<span>{groupProducts.filter((p) => p.category2 === sheet).length}</span>
                                </button>
                              ))}
                          </div>
                        );
                      })
                    ) : isRetailMajor ? (
                      <>
                        <button
                          className={category === "全部产品" && navigationGroup === "all" ? "on" : ""}
                          onClick={() => {
                            setQuery("");
                            setCategory("全部产品");
                            setCategory3Filter("");
                            setSelectedCategoryKey("");
                            setNavigationGroup("all");
                          }}
                        >
                          全部类型
                          <span>{retailProducts.length}</span>
                        </button>
                        {retailTypes.map((type) => {
                          const typeProducts = retailProducts.filter(
                            (product) => product.category2 === type,
                          );
                          return (
                            <button
                              className={selectedCategoryKey === `retail:${type}` ? "on" : ""}
                              key={type}
                              onClick={() => {
                                setQuery("");
                                setCategory(type);
                                setCategory3Filter("");
                                setSelectedCategoryKey(`retail:${type}`);
                                setNavigationGroup("all");
                              }}
                            >
                              {retailTypeDisplayName(type)}
                              <span>{typeProducts.length}</span>
                            </button>
                          );
                        })}
                      </>
                    ) : ([
                        {
                          key: "simulation" as const,
                          name: "主设备",
                          matches: (p: Product) =>
                            unpairedNavigationMajors.has(major) ||
                            p.category1 === "模拟设备" ||
                            (p.category1 === "配套产品" && !isToy(p)),
                        },
                        {
                          key: "toys" as const,
                          name: "配套玩具",
                          matches: (p: Product) => isToy(p),
                        },
                      ]).filter(
                        (section) =>
                          section.key !== "toys" ||
                          !unpairedNavigationMajors.has(major),
                      ).map((section) => {
                        const sectionProducts = productViews.filter(
                          (p) =>
                            navigationMajorMembers(major).includes(
                              p.majorCategory,
                            ) && section.matches(p),
                        );
                        const pairedCategories = section.key === "toys"
                          ? pairedAreasForMajor(major).map((area) =>
                              groupedNavigationArea(area, section.key),
                            )
                          : [];
                        const simulationCategoryOrder = [
                          ...new Set(
                            productViews
                              .filter(
                                (p) =>
                                  navigationMajorMembers(major).includes(
                                    p.majorCategory,
                                  ) && p.category1 === "模拟设备",
                              )
                              .map((p) => groupedNavigationArea(p.category2, section.key)),
                          ),
                        ];
                        const sectionCategories = [...new Set([
                          ...pairedCategories,
                          ...sectionProducts
                            .map((p) => groupedNavigationArea(p.category2, section.key))
                            .filter(
                              (categoryName) =>
                                !pairedCategories.includes(categoryName),
                            ),
                        ])].filter(
                          (categoryName) =>
                            section.key !== "toys" ||
                            major !== "职业体验 / Career Experience" ||
                            categoryName === "医院区" ||
                            !hospitalToySourceCategories.has(categoryName),
                        ).sort((left, right) => {
                          if (section.key !== "toys") return 0;
                          const leftIndex = simulationCategoryOrder.indexOf(left);
                          const rightIndex = simulationCategoryOrder.indexOf(right);
                          if (leftIndex < 0 && rightIndex < 0) return 0;
                          if (leftIndex < 0) return 1;
                          if (rightIndex < 0) return -1;
                          return leftIndex - rightIndex;
                        });
                        if (!sectionProducts.length) return null;
                        const sectionKey = `${major}:${section.key}`;
                        const sectionExpanded = expandedProductGroups.has(sectionKey);
                        return (
                          <div className="subnavGroup" key={section.key}>
                            <div
                              className={
                                category === "全部产品" &&
                                navigationGroup === section.key
                                  ? "subnavGroupHead on"
                                  : "subnavGroupHead"
                              }
                            >
                              <button
                                className="subnavGroupSelect"
                                onClick={() => {
                                  setQuery("");
                                  setCategory("全部产品");
                                  setCategory3Filter("");
                                  setSelectedCategoryKey("");
                                  setNavigationGroup(section.key);
                                }}
                              >
                                <b>{section.name}</b>
                                <span>{sectionProducts.length}</span>
                              </button>
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
                            </div>
                            {sectionExpanded &&
                              sectionCategories.map((c) => {
                                const isHospitalToyGroup =
                                  section.key === "toys" &&
                                  major === "职业体验 / Career Experience" &&
                                  c === "医院区";
                                const categoryProducts = sectionProducts.filter((p) =>
                                  isHospitalToyGroup
                                    ? hospitalToySourceCategories.has(p.category2)
                                    : groupedNavigationArea(p.category2, section.key) === c,
                                );
                                const toyCategoryKey = `${sectionKey}:${c}`;
                                const toyCategoryExpanded =
                                  expandedToyCategories.has(toyCategoryKey);
                                if (section.key !== "toys")
                                  return (
                                    <button
                                      className={
                                        selectedCategoryKey === `${section.key}:${c}`
                                          ? "on"
                                          : ""
                                      }
                                      onClick={() => {
                                        setQuery("");
                                        setCategory(c);
                                        setCategory3Filter("");
                                        setSelectedCategoryKey(`${section.key}:${c}`);
                                        setNavigationGroup(section.key);
                                      }}
                                      key={c}
                                    >
                                      {c}
                                      <span>{categoryProducts.length}</span>
                                    </button>
                                  );
                                return (
                                  <div className="subnavTierGroup" key={c}>
                                    <div className="subnavTierHead">
                                      <button
                                        className={
                                          selectedCategoryKey === `toys:${c}` &&
                                          !category3Filter
                                            ? "on"
                                            : ""
                                        }
                                        onClick={() => {
                                          setQuery("");
                                          setCategory(c);
                                          setCategory3Filter("");
                                          setSelectedCategoryKey(`toys:${c}`);
                                          setNavigationGroup("toys");
                                        }}
                                      >
                                        {c}
                                        <span>{categoryProducts.length}</span>
                                      </button>
                                      <button
                                        className="subnavTierToggle"
                                        aria-label={`${
                                          toyCategoryExpanded ? "收起" : "展开"
                                        }${c}三级目录`}
                                        onClick={() =>
                                          setExpandedToyCategories((current) => {
                                            const next = new Set(current);
                                            if (next.has(toyCategoryKey))
                                              next.delete(toyCategoryKey);
                                            else next.add(toyCategoryKey);
                                            return next;
                                          })
                                        }
                                      >
                                        {toyCategoryExpanded ? "−" : "+"}
                                      </button>
                                    </div>
                                    {toyCategoryExpanded && (
                                      <div className="subnavTertiary">
                                        {(isHospitalToyGroup
                                          ? Object.keys(hospitalToyNavigationGroups)
                                          : ["必配", "选配"]
                                        ).map((tier) => (
                                          <button
                                            className={
                                              selectedCategoryKey === `toys:${c}` &&
                                              category3Filter === tier
                                                ? "on"
                                                : ""
                                            }
                                            key={tier}
                                            onClick={() => {
                                              setQuery("");
                                              setCategory(c);
                                              setCategory3Filter(tier);
                                              setSelectedCategoryKey(`toys:${c}`);
                                              setNavigationGroup("toys");
                                            }}
                                          >
                                            {tier}
                                            <span>
                                              {
                                                isHospitalToyGroup
                                                  ? categoryProducts.filter((p) =>
                                                      hospitalToyNavigationGroups[
                                                        tier as keyof typeof hospitalToyNavigationGroups
                                                      ].includes(p.category2),
                                                    ).length
                                                  : categoryProducts.filter(
                                                      (p) => p.category3 === tier,
                                                    ).length
                                              }
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
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
            <small>九大类映射已写入产品库</small>
          </div>
        </aside>
        <section className="catalog">
          <div className="catalogHead">
            <div>
              <span className="eyebrow">
                {hasGlobalQuery ? "全局搜索 / Global Search" : majorCategoryDisplayName(activeMajor)} ·{" "}
                {isKitchenView ? kitchenProducts.length : visible.length} ITEMS
              </span>
              <h2>{catalogTitle}</h2>
              <p>
                {isKitchenView
                  ? "点击产品卡片打开 SKU 编辑抽屉，黄色按钮将产品加入报价单。"
                  : "一级目录依据 2026 产品册；点击产品卡片打开 SKU 编辑抽屉，黄色按钮将产品加入报价单。"}
              </p>
            </div>
          </div>
          {isKitchenView && (
            <div className="kitchenTabs">
              <div className="kitchenModeTabs">
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
            </div>
          )}
          {filtersOpen && (
            <div className="filterBar" data-filter-surface>
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
                    {isAdmin && (
                      <button
                        className="outline"
                        onClick={() => {
                          setPackageDraft(pack);
                          setPackageManagerOpen(true);
                        }}
                      >
                        配置套餐
                      </button>
                    )}
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
                                    <small className={needsEnglishTranslation(p) ? "missingEnglish" : ""}>
                                      {englishProductName(p)}
                                    </small>
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
                      className={`productCard${isAdmin ? " editableCard" : ""}`}
                      key={p.viewKey || p.id}
                      onClick={isAdmin ? () => openEditor(p) : undefined}
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
                        <p className={`en${needsEnglishTranslation(p) ? " missingEnglish" : ""}`}>
                          {englishProductName(p)}
                        </p>
                        {(!isToy(p) || p.isRecommended) && (
                          <div className="tagRow">
                            {!isToy(p) && (
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
                            <small>{displayPriceLabel(p)} / {p.unit}</small>
                            <strong>{money(displayPrice(p), currency)}</strong>
                          </div>
                          {cart[p.id] ? (
                            <div
                              className="productQuantityControl"
                              aria-label={`${p.name} 数量`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                aria-label={`减少 ${p.name} 数量`}
                                onClick={() => remove(p.id)}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                aria-label={`${p.name} 数量`}
                                value={cart[p.id]}
                                onChange={(e) => {
                                  const quantity = Math.max(
                                    1,
                                    Math.floor(Number(e.target.value) || 1),
                                  );
                                  setCart((current) => ({
                                    ...current,
                                    [p.id]: quantity,
                                  }));
                                }}
                              />
                              <button
                                type="button"
                                aria-label={`增加 ${p.name} 数量`}
                                onClick={() => add(p)}
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <button
                              className="productAddButton"
                              onClick={(e) => {
                                e.stopPropagation();
                                add(p);
                              }}
                            >
                              ＋ 添加
                            </button>
                          )}
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
      {pairingSuggestion && (
        <div
          className={`overlay pairingOverlay${pairingSuggestion.mode === "cart" ? " cartPairingOverlay" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pairing-selection-title"
        >
          <section className="pairingDialog">
            <div className="pairingDialogHead">
              <div>
                <span>PAIRED ITEMS</span>
                <h2 id="pairing-selection-title">
                  {pairingSuggestion.mode === "cart" ? "选择配套玩具" : "选择关联产品"}
                </h2>
              </div>
              <button
                onClick={() => setPairingSuggestion(null)}
                aria-label="关闭关联产品选择"
              >
                ×
              </button>
            </div>
            <div className="pairingDialogLead">
              <div className="pairingDialogSource">
                <Visual p={pairingSuggestion.source} mini />
                <div>
                  <b>{pairingSuggestion.source.name}</b>
                  <small>{pairingSuggestion.source.sku}</small>
                </div>
              </div>
              <p>
                {pairingSuggestion.mode === "cart"
                  ? "为当前 SKU 选择同一模拟区的配套玩具。可勾选新增，也可取消勾选或将数量减至 0 删除配套；保存后，玩具会归在该 SKU 下方，主设备或配套产品的数量不会改变。"
                  : "请确认本次要加入的主设备、配套产品与玩具。已配置的配套项目按保存数量预填；同区域可选项目默认不加入，可按需加减后以母子结构加入报价清单。"}
              </p>
            </div>
            <div className="pairingDialogList">
              <section className="pairingDialogSection">
                <div className="pairingDialogSectionTitle">
                  <b>
                    {pairingSuggestion.mode === "cart"
                      ? "已配置的配套玩具"
                      : "已配置的配套项目"}
                  </b>
                  <small>按已保存的绑定数量默认加入，可调整数量</small>
                </div>
                {pairingDialogItems(
                  pairingSuggestion.relatedItems.filter((item) => item.isBound),
                  pairingSuggestion.mode === "cart"
                    ? "暂无已配置的配套玩具。"
                    : "暂无已配置的配套产品或玩具。",
                )}
              </section>
              {optionalPairingItems.length > 0 && (
                <section className="pairingDialogBatch" aria-label="批量配置可选项目">
                  <label>
                    <input
                      checked={allOptionalPairingItemsSelected}
                      onChange={(event) =>
                        setAllOptionalPairingSelections(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>全选可选项目（已选 {selectedOptionalPairingCount} 款）</span>
                  </label>
                  <label>
                    <span>批量数量</span>
                    <input
                      inputMode="numeric"
                      min="1"
                      onChange={(event) => setPairingBatchQuantity(event.target.value)}
                      pattern="[0-9]*"
                      placeholder="数量"
                      type="text"
                      value={pairingBatchQuantity}
                    />
                  </label>
                  <button
                    className="outline"
                    disabled={
                      !selectedOptionalPairingCount ||
                      !/^[1-9]\d*$/.test(pairingBatchQuantity)
                    }
                    onClick={applyOptionalPairingBatchQuantity}
                    type="button"
                  >
                    填入已勾选项
                  </button>
                </section>
              )}
              {hospitalPairingSource ? (
                <>
                  <div className="pairingDialogTabs" role="group" aria-label="医院玩具分类">
                    {(Object.keys(hospitalPairingGroups) as HospitalPairingGroup[]).map((group) => {
                      const collapsed = collapsedHospitalPairingGroups.has(group);
                      const count = pairingSuggestion.relatedItems.filter(
                        (item) =>
                          !item.isBound &&
                          hospitalPairingGroups[group].includes(item.product.category2 as never),
                      ).length;
                      return (
                        <button
                          type="button"
                          className={collapsed ? "" : "on"}
                          aria-expanded={!collapsed}
                          onClick={() => toggleHospitalPairingGroup(group)}
                          key={group}
                        >
                          {hospitalPairingGroupLabels[group].tab} {collapsed ? "＋" : "−"} <span>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  {(Object.keys(hospitalPairingGroups) as HospitalPairingGroup[]).map((group) => {
                    const collapsed = collapsedHospitalPairingGroups.has(group);
                    const items = pairingSuggestion.relatedItems.filter(
                      (item) =>
                        !item.isBound &&
                        hospitalPairingGroups[group].includes(item.product.category2 as never),
                    );
                    return (
                      <section className="pairingDialogSection" hidden={collapsed} key={group}>
                        <div className="pairingDialogSectionTitle">
                          <b>{hospitalPairingGroupLabels[group].title}</b>
                          <small>默认不加入，可按需加减</small>
                        </div>
                        {pairingDialogItems(items, hospitalPairingGroupLabels[group].empty)}
                      </section>
                    );
                  })}
                  {pairingSuggestion.mode !== "cart" && (
                    <section className="pairingDialogSection">
                      <div className="pairingDialogSectionTitle">
                        <b>同区域配套产品</b>
                        <small>默认不加入，可按需加减</small>
                      </div>
                      {pairingDialogItems(
                        pairingSuggestion.relatedItems.filter(
                          (item) =>
                            !item.isBound &&
                            item.product.category3 === "配套产品",
                        ),
                        "该模拟区暂无可选配产品。",
                      )}
                    </section>
                  )}
                </>
              ) : (
                <section className="pairingDialogSection">
                  <div className="pairingDialogSectionTitle">
                    <b>
                      {pairingSuggestion.mode === "cart"
                        ? "同一个模拟区里的可选配玩具"
                        : "同一个模拟区里的可选配项目"}
                    </b>
                    <small>默认不加入，可按需加减</small>
                  </div>
                  {pairingDialogItems(
                    pairingSuggestion.relatedItems.filter((item) => !item.isBound),
                    pairingSuggestion.mode === "cart"
                      ? "该模拟区暂无可选配玩具。"
                      : "该模拟区暂无可选配产品或玩具。",
                  )}
                </section>
              )}
            </div>
            <div className="pairingDialogFoot">
              <span>
                {pairingSuggestion.relatedItems.length
                  ? `已选 ${pairingSuggestion.relatedItems.filter(({ quantity }) => quantity > 0).length} 款，共 ${pairingSuggestion.relatedItems.reduce((total, item) => total + item.quantity, 0)} 件`
                  : pairingSuggestion.mode === "cart"
                    ? "暂未选择配套玩具"
                    : "仅加入主产品"}
              </span>
              <div>
                {pairingSuggestion.mode === "catalog" && pairingSuggestion.relatedItems.length > 0 && (
                  <button className="outline" onClick={addSourceOnly}>
                    仅加入主产品
                  </button>
                )}
                <button
                  className="primary"
                  onClick={pairingSuggestion.mode === "cart" ? saveCartToyPairing : addSuggestedPairing}
                >
                  {pairingSuggestion.mode === "cart"
                    ? "保存配套玩具"
                    : pairingSuggestion.relatedItems.length > 0
                      ? "确认加入购物车"
                      : "加入购物车"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {pairingRemovalPrompt && (
        <aside className="pairingSuggestion pairingRemovalPrompt" aria-live="assertive">
          <p>关联项目 / PAIRED ITEMS</p>
          <h3>删除 {pairingRemovalPrompt.device.sku}？</h3>
          <span>
            该设备已配对 {pairingRemovalPrompt.relatedItems.length} 个、且已加入报价单的配套项目。
          </span>
          <small>
            {pairingRemovalPrompt.relatedItems
              .slice(0, 3)
              .map(({ product }) => product.sku)
              .join(" · ")}
            {pairingRemovalPrompt.relatedItems.length > 3 ? " …" : ""}
          </small>
          <div className="pairingSuggestionActions">
            <button className="outline" onClick={() => removePairedDevice(false)}>
              保留配套项目
            </button>
            <button className="primary" onClick={() => removePairedDevice(true)}>
              一并删除配套项目
            </button>
          </div>
        </aside>
      )}
      {quoteImportOpen && (
        <div className="overlay importOverlay" role="dialog" aria-modal="true" aria-labelledby="quote-import-title">
          <section className="importDialog">
            <div className="drawerHead">
              <div>
                <span>IMPORT QUOTATION</span>
                <h2 id="quote-import-title">自动导入清单</h2>
              </div>
              <button onClick={() => setQuoteImportOpen(false)} aria-label="关闭导入清单">×</button>
            </div>
            <div className="importBody">
              <p>
                上传 Excel 后，表单中的区域、图片、规格、数量、颜色、备注和体积会作为本次报价依据；同款 SKU 也会优先使用本表图片。导入预览、报价清单与 Excel 均严格保持原表行序和区域。
              </p>
              <label className="importPriceMode">
                <span>导入价格口径 / Price basis</span>
                <select
                  value={quoteImportPriceMode}
                  onChange={(event) =>
                    setQuoteImportPriceMode(
                      event.target.value as QuoteImportPriceMode,
                    )
                  }
                >
                  <option value="factory">出厂价（CNY；小玩具自动使用连锁品牌价）</option>
                  <option value="vip">连锁品牌价（CNY）</option>
                  <option value="usd">美金价格（USD）</option>
                </select>
                <small>
                  主设备可按出厂价、连锁品牌价或美金价格导入；配套小玩具仅使用连锁品牌价或美金价格。
                </small>
              </label>
              <label
                className={quoteImportDragging ? "importDropzone dragging" : "importDropzone"}
                onDragOver={(event) => {
                  event.preventDefault();
                  setQuoteImportDragging(true);
                }}
                onDragLeave={() => setQuoteImportDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setQuoteImportDragging(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) void readQuoteImport(file);
                }}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readQuoteImport(file);
                    event.currentTarget.value = "";
                  }}
                />
                <b>{quoteImporting ? quoteImportTranslationProgress || "正在读取表单…" : quoteImportDragging ? "松开以导入 Excel 表单" : "拖拽 Excel 表单到这里，或点击选择"}</b>
                <small>支持 .xls、.xlsx（最大 200MB）。XLS 会转换为 XLSX，旧格式中的图片和复杂排版可能无法保留，建议优先使用 XLSX。未匹配款号会保留在核对清单中。</small>
              </label>
              {quoteImportError && <p className="importError">{quoteImportError}</p>}
              {quoteImportPreview && (
                <section className="importResult">
                  <div>
                    <b>{quoteImportPreview.fileName}</b>
                    <span>
                      已读取 {quoteImportPreview.sourceRows} 行 · 匹配 {quoteImportPreview.matched.length} 个 SKU · 补入 {quoteImportPreview.imported.length} 个自定义产品
                    </span>
                  </div>
                  <div className="importMetadata">
                    <span>项目名称：{quoteImportPreview.projectName || "表单未提供"}</span>
                    <span>设计师：{quoteImportPreview.designerName || "表单未提供"}</span>
                    <span>商务：{quoteImportPreview.salesName || "表单未提供"}</span>
                  </div>
                  <p>
                    下表金额已按 {quoteImportPriceMode === "factory" ? "出厂价（CNY；小玩具使用连锁品牌价）" : quoteImportPriceMode === "usd" ? "美金价格（USD）" : "连锁品牌价（CNY）"} 计算。
                  </p>
                  <div className="importTableWrap">
                    <table className="importTable">
                      <colgroup>{(quoteImportTemplateRef.current?.headers || importedQuoteHeaders).map((_, index) => <col key={index} />)}</colgroup>
                      <thead>
                        <tr className="sourceFormTitle"><th colSpan={15}>{quoteImportTemplateRef.current?.title || quoteImportPreview.projectName}</th><th colSpan={2}>设计师：{quoteImportPreview.designerName || "—"}</th><th>商务：{quoteImportPreview.salesName || "—"}</th></tr>
                        <tr>
                          {(quoteImportTemplateRef.current?.headers || importedQuoteHeaders).map((lines, index) => <th key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {quoteImportPreview.rows.flatMap(({ product, quantity }, index, rows) => {
                          const cnyPrice = quoteImportPriceMode === "usd" ? product.price : importUnitPrice(product);
                          const usdPrice = product.usd ?? null;
                          const cost = canViewQuoteCost ? product.cost : null;
                          const area = product.importArea || "导入项目";
                          const firstInArea = index === 0 || rows[index - 1].product.importArea !== product.importArea || rows[index - 1].product.importSection !== product.importSection;
                          const areaRows = rows.filter(row => row.product.importArea === product.importArea && row.product.importSection === product.importSection);
                          const areaUsd = areaRows.every(row => excludedFromQuote(row.product) || row.product.usd != null)
                            ? areaRows.reduce((sum, row) => sum + (row.product.usd || 0) * billableQuantity(row.product, row.quantity), 0) : null;
                          return [
                            firstInArea ? <tr className="areaRow" key={`${product.id}-area`}><td></td><td colSpan={13}>{area}</td><td colSpan={2}>{money(areaUsd, "USD", 2)}</td><td colSpan={2}></td></tr> : null,
                            <tr className={`revision-${product.revision?.status || "none"}`} key={product.id}>
                              <td>{product.importSequence ?? index + 1}</td>
                              <td><b>{product.sku}</b></td>
                              <td className={product.revision?.status === "modified" && product.importBlueColumns?.includes(2) ? "revisionModifiedCell" : ""}>{product.name}<small>{englishProductName(product)}</small>{product.quoteCosting && <small>{product.quoteCosting.status === "ready" ? product.quoteCosting.saleSource === "catalog" ? "售价取产品库，成本单独核算" : "已按面积及难度核算售价" : `待核算：${product.quoteCosting.issues.join("；")}`}{quoteImportPriceMode === "usd" && product.quoteCosting.status === "ready" && product.usd == null ? "；尚未配置美元售价，请使用人民币报价" : ""}</small>}</td>
                              <td className={product.revision?.status === "modified" && product.importBlueColumns?.includes(3) ? "revisionModifiedCell" : ""}>{product.image ? <img src={product.image} alt={product.name} /> : "—"}</td>
                              <td className={product.revision?.status === "modified" && product.importBlueColumns?.includes(4) ? "revisionModifiedCell" : ""}>{product.brand || "—"}</td>
                              <td className={product.revision?.changes.some(change => change.field === "规格/尺寸") ? "revisionModifiedCell sourceFormNote" : "sourceFormNote"}>{product.spec || "—"}</td>
                              <td>{product.unit || "—"}</td>
                              <td className={product.revision?.changes.some(change => change.field === "数量") ? "revisionModifiedCell" : ""}>{product.importSourceQuantity === null && quantity === 1 ? "" : quantity}</td>
                              <td>{canViewQuoteCost ? money(cost, "CNY", 2) : "—"}</td>
                              <td>{canViewQuoteCost ? money(cost == null ? null : cost * billableQuantity(product, quantity), "CNY", 2) : "—"}</td>
                              <td>{money(cnyPrice, "CNY", 2)}</td>
                              <td>{money(cnyPrice == null ? null : cnyPrice * billableQuantity(product, quantity), "CNY", 2)}</td>
                              <td>{money(usdPrice, "USD", 2)}</td>
                              <td>{money(usdPrice == null ? null : usdPrice * billableQuantity(product, quantity), "USD", 2)}</td>
                              <td></td>
                              <td className="sourceFormNote">{product.note || "—"}</td>
                              <td className="sourceFormNote">{product.material || "—"}</td>
                              <td>{product.volume || "—"}</td>
                            </tr>,
                          ];
                        })}
                      </tbody>
                      <tfoot>
                        {(["packaging", "formaldehyde", "shipping", "installation", "subtotal", "tax", "total"] as const).map(key => {
                          const labels = { packaging: "包装费", formaldehyde: "除甲醛", shipping: "运输费", installation: "安装费", subtotal: "小计（不含税）", tax: "税额13%（可抵税）", total: "总计" };
                          const fees = quoteImportPreview.fees || { packaging: 0, formaldehyde: 0, shipping: 0, installation: 0, designDeduction: 0 };
                          const total = quotationTotals(quoteImportPreview.rows.reduce((sum, row) => sum + (importUnitPrice(row.product) || 0) * billableQuantity(row.product, row.quantity), 0), importCurrency, fees, Boolean(quoteImportPreview.includeTax), false);
                          const amount = key === "total" ? total.totalWithTax : key === "subtotal" ? total.preTax : key === "tax" ? total.tax : fees[key];
                          return <tr key={key}><td colSpan={8}>{quoteImportTemplateRef.current?.feeLabels?.[key] || labels[key]}</td><td colSpan={importCurrency === "USD" ? 5 : 3}></td><td>{money(amount, importCurrency, 2)}</td><td colSpan={importCurrency === "USD" ? 4 : 6} className="sourceFormNote">{quoteImportTemplateRef.current?.feeNotes?.[key] || ""}</td></tr>;
                        })}
                        {quoteImportTemplateRef.current?.footerNotes?.map((note, index) => <tr key={`note-${index}`}><td colSpan={18} className="sourceFormNote">{note}</td></tr>)}
                      </tfoot>
                    </table>
                  </div>
                  {quoteImportPreview.unmatchedSkus.length > 0 && (
                    <div className="importUnmatched">
                      <b>产品库未收录 {quoteImportPreview.unmatchedSkus.length} 个款号，已按表单资料作为自定义产品补入报价单</b>
                      <span>{quoteImportPreview.unmatchedSkus.join(" · ")}</span>
                    </div>
                  )}
                </section>
              )}
            </div>
            <footer className="importFoot">
              <button className="outline" onClick={() => setQuoteImportOpen(false)}>
                取消
              </button>
              <button
                className="primary"
                disabled={!quoteImportPreview || (!quoteImportPreview.matched.length && !quoteImportPreview.imported.length)}
                onClick={applyQuoteImport}
              >
                导入并替换当前报价单
              </button>
            </footer>
          </section>
        </div>
      )}
      {importedQuotePairingOpen && (
        <main className="importPairingPage" aria-labelledby="import-pairing-title">
          <header className="importPairingHead">
            <div>
              <h1 id="import-pairing-title">玩具匹配</h1>
              <p className="importPairingSteps">导入清单 <b>→</b> 玩具匹配 <b>→</b> 购物车生成报价单</p>
              <p>选择已导入的 SKU 查看关联产品；主设备或配套产品只能匹配同一模拟区的配套玩具。</p>
            </div>
            <div className="importPairingHeadActions">
              <button
                className="outline"
                onClick={() => {
                  setImportedQuotePairingOpen(false);
                  setCartOpen(false);
                }}
                type="button"
              >
                返回主界面
              </button>
            </div>
          </header>
          <section className="importPairingBody" aria-label="导入产品配套玩具">
            <section className="toyMatchingDraftPanel" aria-labelledby="toy-matching-drafts-title">
              <div className="toyMatchingDraftPanelHead">
                <div>
                  <p>未完成清单</p>
                  <h2 id="toy-matching-drafts-title">继续编辑已保存的匹配清单</h2>
                </div>
                <span>{toyMatchingDrafts.length} 份</span>
              </div>
              {toyMatchingDrafts.length ? (
                <div className="toyMatchingDraftRows">
                  {toyMatchingDrafts.map((draft) => (
                    <div className="toyMatchingDraftRow" key={draft.id}>
                      <button className="toyMatchingDraftRestore" onClick={() => void restoreToyMatchingDraft(draft)} type="button">
                      <span>
                        <b>项目名称：{draft.name}</b>
                        <small>最近保存：{new Date(draft.updatedAt).toLocaleString("zh-CN")}</small>
                        {canViewStaff && <small>创建人：{draft.createdBy || "历史账号"}</small>}
                      </span>
                      <strong>继续编辑</strong>
                      </button>
                      <button
                        className="toyMatchingDraftDelete"
                        onClick={() => void deleteToyMatchingDraft(draft)}
                        type="button"
                      >
                        删除草稿
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="toyMatchingDraftEmpty">暂无未完成清单。保存当前进度后，会在这里显示。</p>
              )}
            </section>
            {toyMatchingOverview ? (
              <div className="toyMatchingOverviewEmpty">
                <b>请选择一份未完成清单继续匹配</b>
                <span>点击上方清单的“继续编辑”，即可恢复对应导入 SKU 与配套玩具进度。</span>
              </div>
            ) : importedPairingItems.length ? (
              <div className="importPairingList">
                <div className="importPairingListHead">
                  <b>已导入 SKU</b>
                  <span>共 {importedPairingItems.length} 款 · 点击 SKU 查看关联产品</span>
                </div>
                {importedPairingItems.map(({ product, quantity }) => {
                  const associations = importedProductAssociations.get(product.id) || [];
                  const selected = selectedImportedProductId === product.id;
                  const isAssociationExpanded = expandedImportedRelations.has(product.id);
                  const catalogProduct = product.catalogProductId
                    ? products.find((candidate) => candidate.id === product.catalogProductId)
                    : products.find((candidate) => candidate.sku === product.sku);
                  const simulationArea = pairedArea(
                    catalogProduct?.category2 || product.category2,
                    product.name,
                  );
                  return (
                    <article className={`importPairingItem${selected ? " selected" : ""}`} key={product.id}>
                      <div className="importPairingSelect">
                        <button
                          aria-label={`查看 ${product.name} 大图`}
                          className="importPairingImageButton"
                          onClick={() => setImagePreviewProduct(product)}
                          type="button"
                        >
                          <Visual p={product} mini />
                        </button>
                        <button
                          className="importPairingInfoButton"
                          onClick={() => {
                            setSelectedImportedProductId(product.id);
                            if (associations.length)
                              setExpandedImportedRelations((current) => new Set(current).add(product.id));
                          }}
                          type="button"
                        >
                          <b>{product.name}</b>
                          <small className={needsEnglishTranslation(product) ? "missingEnglish" : ""}>
                            {englishProductName(product)}
                          </small>
                          <small>{product.sku}</small>
                          <span>模拟区：{simulationArea || "待匹配"} · 导入数量 {quantity}</span>
                        </button>
                      </div>
                      <div className="importPairingActions">
                        {!isToy(product) ? (
                          <button
                            className="importPairingButton"
                            onClick={() => openPairingSelection(product, "cart")}
                            type="button"
                          >
                            选择配套玩具
                          </button>
                        ) : (
                          <span className="importPairingToyLabel">配套玩具</span>
                        )}
                      </div>
                      {associations.length > 0 && (
                        <details
                          className="importPairingRelations"
                          onToggle={(event) => {
                            const expanded = event.currentTarget.open;
                            setExpandedImportedRelations((current) => {
                              const next = new Set(current);
                              if (expanded) next.add(product.id);
                              else next.delete(product.id);
                              return next;
                            });
                          }}
                          open={isAssociationExpanded}
                        >
                          <summary>关联产品 · {associations.length} 款</summary>
                          <div className="importPairingRelationList">
                            {associations.map(({ product: relatedProduct, quantity: relatedQuantity }) => (
                              <div className="importPairingRelation" key={`${product.id}-${relatedProduct.id}`}>
                                <button
                                  aria-label={`查看 ${relatedProduct.name} 大图`}
                                  className="importPairingRelationImageButton"
                                  onClick={() => setImagePreviewProduct(relatedProduct)}
                                  type="button"
                                >
                                  <Visual p={relatedProduct} mini />
                                </button>
                                <div>
                                  <b>{relatedProduct.name}</b>
                                  <small>{relatedProduct.sku}</small>
                                </div>
                                <label className="importPairingRelationQuantity">
                                  <span>数量</span>
                                  <div>
                                    <button
                                      aria-label={`减少 ${relatedProduct.sku} 数量`}
                                      disabled={relatedQuantity <= 1}
                                      onClick={() => setImportedAssociationQuantity(product.id, relatedProduct.id, relatedQuantity - 1)}
                                      type="button"
                                    >
                                      −
                                    </button>
                                    <input
                                      aria-label={`${relatedProduct.sku} 数量`}
                                      inputMode="numeric"
                                      min="1"
                                      onChange={(event) => {
                                        if (/^[1-9]\d*$/.test(event.target.value))
                                          setImportedAssociationQuantity(product.id, relatedProduct.id, Number(event.target.value));
                                      }}
                                      pattern="[0-9]*"
                                      type="text"
                                      value={relatedQuantity}
                                    />
                                    <button
                                      aria-label={`增加 ${relatedProduct.sku} 数量`}
                                      onClick={() => setImportedAssociationQuantity(product.id, relatedProduct.id, relatedQuantity + 1)}
                                      type="button"
                                    >
                                      ＋
                                    </button>
                                  </div>
                                </label>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="importPairingEmpty">
                本次导入没有可配置配套玩具的主设备或配套产品。
              </div>
            )}
          </section>
          {!toyMatchingOverview && <footer className="importPairingFoot">
            <span>这里只配置配套玩具；返回购物车后可继续调整数量、删除产品或生成报价单。</span>
            <button
              className="outline"
              disabled={toyMatchingDraftSaving}
              onClick={() => void saveToyMatchingDraft()}
              type="button"
            >
              {toyMatchingDraftSaving ? "保存中…" : "保存草稿"}
            </button>
            <button
              className="primary"
              onClick={() => {
                setImportedQuotePairingOpen(false);
                setCartOpen(true);
              }}
              type="button"
            >
              回到购物车
            </button>
          </footer>}
        </main>
      )}
      {matchingSkuPickerOpen && (
        <div
          className="overlay toyMatchingSkuOverlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMatchingSkuPickerOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="增加 SKU"
        >
          <section className="toyMatchingSkuDialog">
            <div className="toyMatchingDialogHead">
              <div>
                <h2>增加 SKU</h2>
                <p>加入后会出现在当前玩具匹配清单；主设备和配套产品仍只可匹配同模拟区玩具。</p>
              </div>
              <button aria-label="关闭增加 SKU" onClick={() => setMatchingSkuPickerOpen(false)} type="button">×</button>
            </div>
            <label className="toyMatchingSkuSearch">
              <span>搜索 SKU 或名称</span>
              <input autoFocus onChange={(event) => setMatchingSkuQuery(event.target.value)} placeholder="输入款号、名称或模拟区" value={matchingSkuQuery} />
            </label>
            <div className="toyMatchingSkuList">
              {matchingSkuCandidates.map((product) => (
                <button key={product.id} onClick={() => addCatalogProductToToyMatching(product)} type="button">
                  <span className="toyMatchingSkuImage"><Visual p={product} mini /></span>
                  <span>
                    <b>{product.name}</b>
                    <small>{product.sku} · {pairedArea(product.category2, product.name) || "未匹配模拟区"}</small>
                  </span>
                  <em>{isToy(product) ? "配套玩具" : "加入"}</em>
                </button>
              ))}
              {!matchingSkuCandidates.length && <p>没有找到相符 SKU，请换一个关键词。</p>}
            </div>
          </section>
        </div>
      )}
      {imagePreviewProduct && (
        <div
          className="overlay importImagePreview"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setImagePreviewProduct(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={`${imagePreviewProduct.name} 图片预览`}
        >
          <section className="importImagePreviewDialog">
            <button aria-label="关闭图片预览" onClick={() => setImagePreviewProduct(null)} type="button">×</button>
            {imagePreviewProduct.image ? (
              <img alt={imagePreviewProduct.name} src={imagePreviewProduct.image} />
            ) : (
              <p>该 SKU 暂无可查看的大图。</p>
            )}
            <div><b>{imagePreviewProduct.name}</b><span>{imagePreviewProduct.sku}</span></div>
          </section>
        </div>
      )}
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
                  连锁品牌价（人民币） / Chain Brand Price (CNY)
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
                  尺寸 / Specification
                  <input
                    value={draft.spec}
                    onChange={(e) => setDraft({ ...draft, spec: e.target.value })}
                    placeholder="主设备必须填写尺寸"
                  />
                </label>
                <label>
                  单位 / Unit
                  <input
                    value={draft.unit}
                    onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                    placeholder="个、套、组、盒等"
                  />
                </label>
                <label>
                  成本（CNY） / Cost
                  <input
                    min="0"
                    type="number"
                    value={draft.cost ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        cost: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="待补"
                  />
                </label>
                <label>
                  分公司价（USD） / Branch price
                  <input
                    min="0"
                    type="number"
                    value={draft.branchPrice ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        branchPrice:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="待补"
                  />
                </label>
                <label>
                  供应方式 / Supply method
                  <select
                    value={draft.supplyMethod || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, supplyMethod: e.target.value || null })
                    }
                  >
                    <option value="">待补</option>
                    <option value="自有生产">自有生产</option>
                    <option value="外采">外采</option>
                  </select>
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
                  每一行是一条分类记录；同一个 SKU 可以无限增加分类记录。
                </p>
                <div className="classificationRecordList">
                  {draft.classifications.map((record, index) => (
                    <div className="classificationRecord" key={record.id}>
                      <span>记录 {index + 1}</span>
                      <label>
                        1级分类
                        <select
                          value={record.level1}
                          onChange={(event) => setDraft({
                            ...draft,
                            classifications: draft.classifications.map((item) =>
                              item.id === record.id ? { ...item, level1: event.target.value } : item,
                            ),
                          })}
                        >
                          {majorCategories.map((name) => <option key={name} value={name}>{majorCategoryDisplayName(name)}</option>)}
                        </select>
                      </label>
                      <label>
                        2级分类
                        <input
                          list="level-2-classifications"
                          value={record.level2}
                          onChange={(event) => setDraft({
                            ...draft,
                            classifications: draft.classifications.map((item) =>
                              item.id === record.id ? { ...item, level2: event.target.value } : item,
                            ),
                          })}
                        />
                      </label>
                      <label>
                        3级分类
                        <input
                          list="level-3-classifications"
                          value={record.level3}
                          onChange={(event) => setDraft({
                            ...draft,
                            classifications: draft.classifications.map((item) =>
                              item.id === record.id ? { ...item, level3: event.target.value } : item,
                            ),
                          })}
                        />
                      </label>
                      <button
                        className="outline"
                        disabled={draft.classifications.length === 1}
                        onClick={() => setDraft({
                          ...draft,
                          classifications: draft.classifications.filter((item) => item.id !== record.id),
                        })}
                        type="button"
                      >
                        删除此记录
                      </button>
                    </div>
                  ))}
                </div>
                <datalist id="level-2-classifications">
                  {[...new Set(productViews.map((product) => product.category1))].map((name) => <option key={name} value={name} />)}
                </datalist>
                <datalist id="level-3-classifications">
                  {[...new Set(productViews.map((product) => product.category2))].map((name) => <option key={name} value={name} />)}
                </datalist>
                <button
                  className="outline addClassificationRecordButton"
                  onClick={() => setDraft({
                    ...draft,
                    classifications: [
                      ...draft.classifications,
                      {
                        id: crypto.randomUUID(),
                        productId: draft.id,
                        level1: draft.classifications[0]?.level1 || draft.majorCategory,
                        level2: draft.classifications[0]?.level2 || draft.category1,
                        level3: "",
                      },
                    ],
                  })}
                  type="button"
                >
                  ＋ 增加分类记录
                </button>
                <label className="productTagsField">
                  标签
                  <input
                    value={tagDraftText}
                    onChange={(event) => setTagDraftText(event.target.value)}
                    placeholder="例如：配套玩具、芯片款、英文版"
                  />
                  <small>多个标签用逗号或顿号分隔，可继续增加。</small>
                </label>
              </section>
              <section className="editSection">
                <h3>识别标签</h3>
                {isToy(draft) ? (
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
        <div
          className="overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCartOpen(false);
          }}
        >
          <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawerHead">
              <div>
                <span>YOUR SELECTION · {currency}</span>
                <h2>报价清单</h2>
              </div>
              <button onClick={() => setCartOpen(false)}>×</button>
            </div>
            <div className="drawerContent">
              {cartHierarchyItems.length > 0 && (
                <div className="cartSelectionBar">
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        cartHierarchyItems.length > 0 &&
                        cartHierarchyItems.every((item) =>
                          selectedCartItemKeys.has(
                            quoteQuantityKey(item.product.id, item.parentId),
                          ),
                        )
                      }
                      onChange={(event) => {
                        setSelectedCartItemKeys(
                          event.target.checked
                            ? new Set(
                                cartHierarchyItems.map((item) =>
                                  quoteQuantityKey(item.product.id, item.parentId),
                                ),
                              )
                            : new Set(),
                        );
                      }}
                    />
                    全选
                  </label>
                  <span>已选 {selectedCartItemKeys.size} 项</span>
                  <button
                    className="cartBatchDeleteButton"
                    disabled={!selectedCartItemKeys.size}
                    onClick={() => removeCartItems(selectedCartItemKeys)}
                    type="button"
                  >
                    删除已选
                  </button>
                </div>
              )}
              {cartHierarchyItems.map(({ product: p, quantity, parentId }) => (
                <div
                  className={`cartItem${parentId ? " cartChildItem" : ""}${quantity === 0 ? " cartZeroQuantity" : ""}`}
                  key={`${parentId || "root"}-${p.id}`}
                >
                  <label className="cartSelectControl">
                    <input
                      aria-label={`选择 ${p.sku || p.name}`}
                      checked={selectedCartItemKeys.has(
                        quoteQuantityKey(p.id, parentId),
                      )}
                      onChange={(event) =>
                        toggleCartItemSelection(
                          quoteQuantityKey(p.id, parentId),
                          event.target.checked,
                        )
                      }
                      type="checkbox"
                    />
                  </label>
                  <div className="cartImage">
                    <Visual p={p} mini />
                  </div>
                  <div className="cartInfo">
                    {parentId && <span className="cartRelationLabel">关联产品 / Paired item</span>}
                    <b>{p.name}</b>
                    <small className={needsEnglishTranslation(p) ? "missingEnglish" : ""}>
                      {englishProductName(p)}
                    </small>
                    <small className="cartSku">{p.sku}</small>
                    <strong>
                      {money(
                        displayPrice(p) === null
                          ? null
                          : displayPrice(p)! * quantity,
                        currency,
                      )}
                    </strong>
                  </div>
                  <div className="qty">
                    <div className="qtyLabel">
                      <span>数量</span>
                      <span className="cartQuantityControl">
                        <button
                          aria-label={`${p.sku || p.name} 减少数量`}
                          disabled={quantity <= 0}
                          onClick={() =>
                            setQuoteItemQuantity(p.id, quantity - 1, parentId)
                          }
                          type="button"
                        >
                          −
                        </button>
                        <input
                          aria-label={`${p.sku || p.name} 数量`}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          type="text"
                          value={
                            quoteQuantityDrafts[quoteQuantityKey(p.id, parentId)] ??
                            String(quantity)
                          }
                          onChange={(event) => {
                            const value = event.target.value;
                            if (!/^\d*$/.test(value)) return;
                            const quantityKey = quoteQuantityKey(p.id, parentId);
                            setQuoteQuantityDrafts((current) => ({
                              ...current,
                              [quantityKey]: value,
                            }));
                            if (value !== "")
                              setQuoteItemQuantity(p.id, Number(value), parentId);
                          }}
                          onBlur={() => {
                            const quantityKey = quoteQuantityKey(p.id, parentId);
                            const value = quoteQuantityDrafts[quantityKey];
                            if (value === undefined) return;
                            if (value !== "")
                              setQuoteItemQuantity(p.id, Number(value), parentId);
                            setQuoteQuantityDrafts((current) => {
                              const next = { ...current };
                              delete next[quantityKey];
                              return next;
                            });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                        <button
                          aria-label={`${p.sku || p.name} 增加数量`}
                          onClick={() =>
                            setQuoteItemQuantity(p.id, quantity + 1, parentId)
                          }
                          type="button"
                        >
                          +
                        </button>
                      </span>
                    </div>
                    <button
                      className="cartDeleteButton"
                      onClick={() =>
                        removeCartItems(
                          new Set([quoteQuantityKey(p.id, parentId)]),
                        )
                      }
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="drawerFoot">
              <div className="summary">
                <span>共 {cartItems.length} 项</span>
                <b>{money(subtotal, currency)}</b>
              </div>
              <div className="cartFootActions">
                <button className="outline clearQuotation" onClick={clearQuotation}>
                  ⟲ 一键清除清单
                </button>
                <button
                  className="primary"
                  disabled={quotePreparing}
                  onClick={async () => {
                    setQuotePreparing(true);
                    try {
                      const translated = await bilingualQuoteProducts(quoteCartItems);
                      setRestoredQuoteProducts(current => [...current.filter(product => !translated.some(item => item.id === product.id)), ...translated]);
                      setCartOpen(false);
                      setQuoteActiveTab("all");
                      setRecordedQuoteHistoryId("");
                      setQuoteHistoryLineageId("");
                      setQuoteHistoryNotice("");
                      setQuoteHistoryMode("new");
                      setPendingHistoryExport(null);
                      setQuoteOpen(true);
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "报价翻译未完成，请重试");
                    } finally {setQuotePreparing(false);}
                  }}
                >
                  {quotePreparing ? "正在准备中英文报价…" : "生成报价单"}
                </button>
              </div>
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
                  {quoteHistoryMode === "view" ? (
                    <a className="outline quoteHistoryLink" href="/quotation-history">
                      返回报价历史 / Back to history
                    </a>
                  ) : (
                    <>
                      <a className="outline quoteHistoryLink" href="/quotation-history">
                        报价历史
                      </a>
                      <button className="outline" onClick={() => void exportQuoteExcel()}>
                        导出 Excel / Export Excel
                      </button>
                      <button
                        className="primary"
                        disabled={quoteHistorySaving}
                        onClick={() => void exportQuotePdf()}
                      >
                        导出 PDF / Export PDF
                      </button>
                    </>
                  )}
                </div>
              </div>
            {quoteHistoryMode === "view" && quoteHistoryNotice && <p className="quoteHistoryQuoteNotice" role="status">{quoteHistoryNotice}</p>}
            <article
              className={`quotePaper quotePaperWide${quoteHistoryMode === "view" ? " quotePaperReadOnly" : ""}`}
              inert={quoteHistoryMode === "view" ? true : undefined}
            >
              <header className="quoteHeader">
                <div className="quoteBrand">
                  <CompanyLogo className="quoteLogo" />
                </div>
                <div>
                  <span>QUOTATION · {currency}</span>
                  <h1>产品报价清单 / Product Quotation</h1>
                </div>
              </header>
              {workplaceNotice && <p role="status">{workplaceNotice}</p>}
              <section className="quoteMeta">
                <div>
                  <label>项目名称 / Project</label>
                  <input
                    value={quoteProject}
                    readOnly={Boolean(workspaceProjectId)}
                    onChange={(e) => setQuoteProject(e.target.value)}
                    placeholder="请输入项目名称"
                  />
                </div>
                <div>
                  <label>项目合同号 / Contract No.</label>
                  <input
                    value={quoteContractNo}
                    onChange={(e) => setQuoteContractNo(e.target.value)}
                    placeholder="请输入项目合同号"
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
                  <select
                    className="quoteCurrencySelect"
                    value={priceMode}
                    onChange={(event) => requestPriceModeChange(event.target.value as PriceMode)}
                    aria-label="选择报价币种"
                  >
                    <option value="factory">出厂价 / Factory (CNY)</option>
                    <option value="vip">连锁品牌价 / Chain Brand Price (CNY)</option>
                    <option value="usd">美元 / USD</option>
                  </select>
                </div>
                <div>
                  <label>报价日期 / Date</label>
                  <b>{new Date().toLocaleDateString("zh-CN")}</b>
                </div>
                <div>
                  <label>报价产品 / Items</label>
                  <b>{quoteCartItems.length} 项 / Items</b>
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
                <div className="quoteLeadTop">
                  <div>
                    <h2>亦玩集团产品报价清单 / Yifun Life Product Quotation</h2>
                    <p>
                      产品按体验区域归类；同一区域的玩具与模拟设备会汇总在一起。 /
                      Products are grouped by experience area.
                    </p>
                  </div>
                  {quoteHistoryMode !== "view" && (
                    <div className="quoteLeadActions">
                      <button className="outline" onClick={() => setQuoteOpen(false)} type="button">
                        返回选品添加 SKU
                      </button>
                      <button
                        className="outline"
                        disabled={!selectedCartItemKeys.size}
                        onClick={() => removeCartItems(selectedCartItemKeys)}
                        type="button"
                      >
                        删除已选{selectedCartItemKeys.size ? ` · ${selectedCartItemKeys.size}` : ""}
                      </button>
                    </div>
                  )}
                </div>
              </section>
              <nav className="quoteAreaTabs" aria-label="报价区域">
                {quoteImportTemplateRef.current && <button className={quoteActiveTab === "all" ? "active" : ""} onClick={() => setQuoteActiveTab("all")}>完整表单 / Full quotation</button>}
                <button
                  className={quoteActiveTab === "summary" ? "active" : ""}
                  onClick={() => setQuoteActiveTab("summary")}
                >
                  总览 / Summary
                </button>
                {quoteGroups.map(([area, items]) => (
                  <button
                    className={quoteActiveTab === area ? "active" : ""}
                    key={`${area}-${items[0]?.product.id}`}
                    onClick={() => setQuoteActiveTab(area)}
                  >
                    {area} · {items.length} 项
                  </button>
                ))}
              </nav>
              <div className="quoteTableWrap">
              <table className="quoteTable">
                <colgroup>{(quoteImportTemplateRef.current?.headers || importedQuoteHeaders).map((_, index) => <col key={index} />)}</colgroup>
                <thead>
                  <tr className="sourceFormTitle"><th colSpan={15}>{quoteImportTemplateRef.current?.title || "亦玩集团+地区+品牌名&报价清单"}</th><th colSpan={2}>设计师：{designerName || "—"}</th><th>商务：{salesName || "—"}</th></tr>
                  <tr>
                    {(quoteImportTemplateRef.current?.headers || importedQuoteHeaders).map((lines, index) => <th key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {quoteActiveTab === "summary"
                    ? quoteGroups.flatMap(([area, items]) => {
                      const isExpanded = quoteExpandedAreas.has(area);
                      return [
                        <tr className="quoteAreaSummaryRow" key={`${area}-${items[0]?.product.id}-summary`}>
                          <td colSpan={12}>
                            <button
                              aria-expanded={isExpanded}
                              className="quoteAreaExpand"
                              onClick={() => toggleQuoteArea(area)}
                            >
                              <span>{isExpanded ? "−" : "+"}</span>
                              <b>{area}</b>
                            </button>
                          </td>
                          <td colSpan={2}>{items.length} 项 / Items</td>
                          <td colSpan={4}>
                            <button
                              className="quoteAreaExpand quoteAreaTotal"
                              onClick={() => toggleQuoteArea(area)}
                            >
                              {money(quoteAreaSubtotal(items), currency, 2)}
                            </button>
                          </td>
                        </tr>,
                        ...(isExpanded
                          ? items.map((item) =>
                              renderQuoteItemRow(
                                item,
                                quoteItemsInOrder.indexOf(item) + 1,
                              ),
                            )
                          : []),
                      ];
                    })
                    : quoteVisibleGroups.flatMap(([area, items]) => [
                    <tr className="areaRow" key={`${area}-${items[0]?.product.id}-area`}>
                      <td></td><td colSpan={13}>{area}</td><td colSpan={2}>{money(items.every(item => excludedFromQuote(item.product) || item.product.usd != null) ? items.reduce((sum, item) => sum + (item.product.usd || 0) * billableQuantity(item.product, item.quantity), 0) : null, "USD", 2)}</td><td colSpan={2}></td>
                    </tr>,
                    ...items.map((item) =>
                      renderQuoteItemRow(
                        item,
                        quoteItemsInOrder.indexOf(item) + 1,
                      ),
                    ),
                    <tr className="quoteAreaSubtotalRow" key={`${area}-${items[0]?.product.id}-subtotal`}>
                      <td colSpan={15}>区域小计 / Area Subtotal</td>
                      <td colSpan={3}>{money(quoteAreaSubtotal(items), currency, 2)}</td>
                    </tr>,
                  ])}
                </tbody>
                <tfoot>
                  <tr className="costRow">
                    <td className="feeLabel" colSpan={8}>
                      {quoteImportTemplateRef.current?.feeLabels?.packaging || "包装费（含部分产品特定包装箱） / Packaging fee (including special packing cases)"}
                    </td>
                    <td colSpan={currency === "USD" ? 5 : 3}></td>
                    <td className="feeAmount" colSpan={1}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={fees.packaging}
                        onChange={(e) =>
                          setFees({
                            ...fees,
                            packaging: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="feeNote sourceFormNote" colSpan={currency === "USD" ? 4 : 6}>{quoteImportTemplateRef.current?.feeNotes?.packaging || ""}</td>
                  </tr>
                  <tr className="costRow">
                    <td className="feeLabel" colSpan={8}>{quoteImportTemplateRef.current?.feeLabels?.formaldehyde || "除甲醛 / Formaldehyde removal"}</td>
                    <td colSpan={currency === "USD" ? 5 : 3}></td>
                    <td className="feeAmount" colSpan={1}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={fees.formaldehyde}
                        onChange={(e) =>
                          setFees({
                            ...fees,
                            formaldehyde: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="feeNote sourceFormNote" colSpan={currency === "USD" ? 4 : 6}>{quoteImportTemplateRef.current?.feeNotes?.formaldehyde || ""}</td>
                  </tr>
                  <tr className="costRow">
                    <td className="feeLabel" colSpan={8}>
                      {quoteImportTemplateRef.current?.feeLabels?.shipping || "运输费（含装货不含卸货） / Shipping fee (loading included, unloading excluded)"}
                    </td>
                    <td colSpan={currency === "USD" ? 5 : 3}></td>
                    <td className="feeAmount" colSpan={1}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={fees.shipping}
                        onChange={(e) =>
                          setFees({
                            ...fees,
                            shipping: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="feeNote sourceFormNote" colSpan={currency === "USD" ? 4 : 6}>{quoteImportTemplateRef.current?.feeNotes?.shipping || ""}</td>
                  </tr>
                  <tr className="costRow">
                    <td className="feeLabel" colSpan={8}>
                      {quoteImportTemplateRef.current?.feeLabels?.installation || "安装费 / Installation fee"}{" "}
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
                    <td colSpan={currency === "USD" ? 5 : 3}></td>
                    <td className="feeAmount" colSpan={1}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={fees.installation}
                        onChange={(e) =>
                          setFees({
                            ...fees,
                            installation: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </td>
                    <td className="feeNote sourceFormNote" colSpan={currency === "USD" ? 4 : 6}>{quoteImportTemplateRef.current?.feeNotes?.installation || ""}</td>
                  </tr>
                  <tr className="feeSummaryRow">
                    <td className="feeLabel" colSpan={8}>
                      {quoteImportTemplateRef.current?.feeLabels?.subtotal || "小计（不含税） / Subtotal (tax excluded)"}
                      <span className="taxControl">
                        <label htmlFor="quote-tax-mode">税额 / Tax</label>
                        <select
                          id="quote-tax-mode"
                          className="taxModeSelect"
                          value={includeTax ? "included" : "excluded"}
                          disabled={currency === "USD"}
                          onChange={(event) =>
                            setIncludeTax(event.target.value === "included")
                          }
                        >
                          <option value="included">含税 13% / Tax included (13%)</option>
                          <option value="excluded">不含税 / Tax excluded</option>
                        </select>
                        {currency === "USD" && (
                          <small>美元订单不含税 / USD orders are tax excluded</small>
                        )}
                      </span>
                    </td>
                    <td colSpan={currency === "USD" ? 5 : 3}></td>
                    <td className="feeAmount" colSpan={1}>{money(preTax, currency, 2)}</td>
                    <td className="feeNote" colSpan={currency === "USD" ? 4 : 6}>
                      产品与附加费用合计 / Products and additional fees
                    </td>
                  </tr>
                  {(currency === "CNY" && includeTax || quoteImportTemplateRef.current?.feeRows?.tax) && (
                    <tr className="costRow">
                      <td className="feeLabel" colSpan={8}>
                        {quoteImportTemplateRef.current?.feeLabels?.tax || "税额 13%（可抵税） / Tax 13% (deductible)"}
                      </td>
                      <td colSpan={currency === "USD" ? 5 : 3}></td>
                      <td className="feeAmount" colSpan={1}>{money(tax, currency, 2)}</td>
                      <td className="feeNote" colSpan={currency === "USD" ? 4 : 6}>
                        按不含税小计计算 / Calculated on pre-tax subtotal
                      </td>
                    </tr>
                  )}
                  {showDesignDeduction ? (
                    <tr className="costRow">
                      <td className="feeLabel" colSpan={8}>
                        设计费抵扣 / Design fee deduction{" "}
                        <button
                          className="hideDeduction"
                          onClick={() => setShowDesignDeduction(false)}
                        >
                          隐藏 / Hide
                        </button>
                      </td>
                      <td colSpan={currency === "USD" ? 5 : 3}></td>
                    <td className="feeAmount" colSpan={1}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={fees.designDeduction}
                          onChange={(e) =>
                            setFees({
                              ...fees,
                              designDeduction: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </td>
                      <td className="feeNote" colSpan={currency === "USD" ? 4 : 6}>&nbsp;</td>
                    </tr>
                  ) : (
                    <tr className="showDeduction">
                      <td colSpan={18}>
                        <button onClick={() => setShowDesignDeduction(true)}>
                          ＋ 显示设计费抵扣 / Show design fee deduction
                        </button>
                      </td>
                    </tr>
                  )}
                  <tr className="grandTotal">
                    <td className="feeLabel" colSpan={8}>
                      {quoteImportTemplateRef.current?.feeLabels?.total || (currency === "CNY" && includeTax
                        ? "总计（含税） / Total (tax included)"
                        : "总计（不含税） / Total (tax excluded)")}
                    </td>
                    <td colSpan={currency === "USD" ? 5 : 3}></td>
                    <td className="feeAmount" colSpan={1}>{money(totalWithTax, currency, 2)}</td>
                    <td className="feeNote" colSpan={currency === "USD" ? 4 : 6}>
                      {showDesignDeduction && fees.designDeduction > 0
                        ? currency === "CNY" && includeTax
                          ? "已含税并扣除设计费 / Tax included, design deduction applied"
                          : "未含税，已扣除设计费 / Tax excluded, design deduction applied"
                        : currency === "CNY" && includeTax
                          ? "已含税 / Tax included"
                          : "未含税 / Tax excluded"}
                    </td>
                  </tr>
                  {quoteImportTemplateRef.current?.footerNotes?.map((note, index) => <tr key={`note-${index}`}><td colSpan={18} className="sourceFormNote">{note}</td></tr>)}
                </tfoot>
              </table>
              </div>
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
            <article className="quotePrintPaper" aria-hidden="true">
              <header className="quotePrintHeader">
                <CompanyLogo className="quotePrintLogo" />
                <div className="quotePrintTitle">
                  <span>QUOTATION · {currency}</span>
                  <PrintBilingual zh="产品报价清单" en="Product Quotation" />
                </div>
              </header>
              <section className="quotePrintMeta">
                <div><PrintBilingual zh="项目名称" en="Project" /><b>{printValue(quoteProject)}</b></div>
                <div><PrintBilingual zh="设计师名称" en="Designer" /><b>{printValue(designerName)}</b></div>
                <div><PrintBilingual zh="业务员名称" en="Sales" /><b>{printValue(salesName)}</b></div>
                <div><PrintBilingual zh="报价币种" en="Currency" /><b>{currency}</b></div>
                <div><PrintBilingual zh="报价日期" en="Date" /><b>{new Date().toLocaleDateString("zh-CN")}</b></div>
                <div><PrintBilingual zh="报价产品" en="Items" /><b>{quoteCartItems.length}</b></div>
              </section>
              {quoteGroups.map(([area, items]) => {
                const areaLabel = splitBilingual(area);
                const title = <div className="quotePrintAreaTitle"><PrintBilingual {...areaLabel} /><span>{items.length} 项<small>{items.length} Items</small></span></div>;
                const columns = <div className="quotePrintColumnHeader">
                  <PrintBilingual zh="序号" en="No." /><PrintBilingual zh="图片" en="Image" /><PrintBilingual zh="产品名称" en="Product" /><PrintBilingual zh="品牌" en="Brand" /><PrintBilingual zh="规格/尺寸" en="Size" /><PrintBilingual zh="单位" en="Unit" /><PrintBilingual zh="数量" en="Qty" />
                  <PrintBilingual zh={currency === "USD" ? "美元单价" : "人民币单价"} en={currency === "USD" ? "USD Unit Price" : "CNY Unit Price"} />
                  <PrintBilingual zh={currency === "USD" ? "美元报价" : "人民币报价"} en={currency === "USD" ? "USD Amount" : "CNY Amount"} />
                  <PrintBilingual zh="颜色" en="Colour" /><PrintBilingual zh="体积" en="Volume" /><PrintBilingual zh="备注" en="Remarks" />
                </div>;
                const subtotal = <div className="quotePrintAreaSubtotal"><PrintBilingual zh="区域小计" en="Area subtotal" /><strong className="quotePrintAmount">{money(quoteAreaSubtotal(items), currency)}</strong></div>;
                return (
                  <section className="quotePrintArea" key={`print-${area}`}>
                    {items.length === 1 ? (
                      <div className="quotePrintAreaSingle">
                        {title}
                        {columns}
                        {renderPrintQuoteItem(items[0], quoteItemsInOrder.indexOf(items[0]) + 1)}
                        {subtotal}
                      </div>
                    ) : (
                      <>
                        <div className="quotePrintAreaOpening">
                          {title}
                          {columns}
                          {renderPrintQuoteItem(items[0], quoteItemsInOrder.indexOf(items[0]) + 1)}
                        </div>
                        {items.slice(1, -1).map((item) => renderPrintQuoteItem(item, quoteItemsInOrder.indexOf(item) + 1))}
                        <div className="quotePrintAreaTail">
                          {renderPrintQuoteItem(items[items.length - 1], quoteItemsInOrder.indexOf(items[items.length - 1]) + 1)}
                          {subtotal}
                        </div>
                      </>
                    )}
                  </section>
                );
              })}
              <section className="quotePrintFees">
                <div className="quotePrintFee"><PrintBilingual zh="包装费（含部分产品特定包装箱）" en="Packaging fee (including special packing cases)" /><strong className="quotePrintAmount">{money(fees.packaging, currency)}</strong></div>
                <div className="quotePrintFee"><PrintBilingual zh="除甲醛" en="Formaldehyde removal" /><strong className="quotePrintAmount">{money(fees.formaldehyde, currency)}</strong></div>
                <div className="quotePrintFee"><PrintBilingual zh="运输费（含装货不含卸货）" en="Shipping fee (loading included, unloading excluded)" /><strong className="quotePrintAmount">{money(fees.shipping, currency)}</strong></div>
                <div className="quotePrintFee"><PrintBilingual zh={installationIncludesTravel ? "安装费（含工人出行食宿）" : "安装费（不含工人出行食宿）"} en={installationIncludesTravel ? "Installation fee (travel and accommodation included)" : "Installation fee (travel and accommodation excluded)"} /><strong className="quotePrintAmount">{money(fees.installation, currency)}</strong></div>
                <div className="quotePrintFee quotePrintSubtotal"><PrintBilingual zh="小计（不含税）" en="Subtotal (tax excluded)" /><strong className="quotePrintAmount">{money(preTax, currency)}</strong></div>
                {currency === "CNY" && includeTax && <div className="quotePrintFee"><PrintBilingual zh="税额 13%（可抵税）" en="Tax 13% (deductible)" /><strong className="quotePrintAmount">{money(tax, currency)}</strong></div>}
                {showDesignDeduction && fees.designDeduction > 0 && <div className="quotePrintFee"><PrintBilingual zh="设计费抵扣" en="Design fee deduction" /><strong className="quotePrintAmount">−{money(fees.designDeduction, currency)}</strong></div>}
                <div className="quotePrintFee quotePrintGrandTotal"><PrintBilingual zh={currency === "CNY" && includeTax ? "总计（含税）" : "总计（不含税）"} en={currency === "CNY" && includeTax ? "Total (tax included)" : "Total (tax excluded)"} /><strong className="quotePrintAmount">{money(totalWithTax, currency)}</strong></div>
              </section>
              <footer className="quotePrintFooter"><span>{printValue(companyAddress)}</span><span>第 <i /> 页<small>Page <i /></small></span></footer>
            </article>
          </div>
        </div>
      )}
    </main>
  );
}
