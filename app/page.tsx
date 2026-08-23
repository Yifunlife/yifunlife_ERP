"use client";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from "../node_modules/.pnpm/fflate@0.7.5/node_modules/fflate/esm/browser.js";
import type { CatalogProduct } from "./catalog-types";
import { pairedAreasForMajor } from "../lib/area-pairing";
type MajorCategory =
  | "职业体验 / Career Experience"
  | "生活场景 / Lifestyle Scene"
  | "零售（游玩必备） / Retail"
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
  importArea?: string;
  importSourceRow?: number;
};
type ProductRelation = {
  productId: string;
  relatedProductId: string;
  quantity?: number;
};
type PairingSuggestion = {
  source: Product;
  relatedItems: Array<{ product: Product; quantity: number }>;
};
type PairingRemovalPrompt = {
  device: Product;
  relatedItems: Array<{ product: Product; quantity: number }>;
};
type QuoteImportPreview = {
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
type QuoteImportColumns = {
  quantity: number;
  cnyUnit: number;
  cnyAmount: number;
  usdUnit: number;
  usdAmount: number;
  areaSubtotal: number;
};
type QuoteImportTemplate = {
  source: ArrayBuffer;
  fileName: string;
  columns: QuoteImportColumns;
  totalRow?: number;
  metadata: {
    designer?: { row: number; column: number };
    sales?: { row: number; column: number };
  };
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
  "零售（游玩必备） / Retail",
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
  "农牧生活 / 动物世界",
  "车生活 / Car Life",
  "拼装手工 / Assemble by Hand",
  "机械传动 / Playground Scenes",
  "多媒体互动 / Multimedia Interactivity",
  "零售（游玩必备） / Retail",
];
const unpairedNavigationMajors = new Set<NavigationMajor>([
  "机械传动 / Playground Scenes",
  "多媒体互动 / Multimedia Interactivity",
  "零售（游玩必备） / Retail",
]);
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
const unitLabel = (unit: string) => ({
  zh: unit || "—",
  en: unitEnglish[unit] || (unit ? "Unit" : "—"),
});
const isSpaceTheme = (name: string, en: string) => /太空|space/i.test(`${name} ${en}`);
const screenWords = /屏|screen|投影|多媒体|互动|vr|电视|监视/i;
const money = (value: number | null, currency: "CNY" | "USD") => {
  if (value === null) return "待确认";
  const amount = new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-US", {
    minimumFractionDigits: currency === "CNY" ? 0 : 2,
    maximumFractionDigits: currency === "CNY" ? 0 : 2,
  }).format(value);
  return currency === "CNY" ? `CNY ¥${amount}` : `USD $${amount}`;
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
  "junior-Y10535": "Repair walls and cabinets",
  "junior-Y10536": "Tire rack",
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
  "junior-Y10556": "semicircle detective cabinet",
  "junior-Y10557": "architect wardrobe",
  "junior-Y10558": "architect hat cabinet",
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
  return `${p.category2 || p.category1} / Experience Area`;
};
const importedSkuCodes = (value: unknown) =>
  String(value || "")
    .toUpperCase()
    .match(/Y\d+(?:-[A-Z0-9]+)?/g) || [];
const importCellText = (value: unknown) =>
  String(value || "")
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
      const label = importCellText(row[columnIndex]);
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
    .map(importCellText)
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
  const images = new Map<string, string>();
  try {
    const archive = XLSX.CFB.read(new Uint8Array(data), { type: "array" });
    const fileBySuffix = (suffix: string) => {
      const index = archive.FullPaths.findIndex((path) => path.endsWith(suffix));
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
      if (image) images.set(match[1], URL.createObjectURL(new Blob([image as BlobPart], { type: imageMimeType(path) })));
    }
  } catch {
    // .xls and .csv files do not contain the .xlsx image package.
  }
  return images;
};
const xmlText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const updateTemplateCell = (
  xml: string,
  cellRef: string,
  value: string | number,
) => {
  const rowNumber = XLSX.utils.decode_cell(cellRef).r + 1;
  const rowPattern = new RegExp(`(<row\\b[^>]*\\br="${rowNumber}"[^>]*>)([\\s\\S]*?)(</row>)`);
  return xml.replace(rowPattern, (_row, rowStart, rowContent, rowEnd) => {
    const cellPattern = new RegExp(
      `<c\\b([^>]*\\br="${cellRef}"[^>]*)(?:\\/>|>[\\s\\S]*?<\\/c>)`,
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
      `<c\\b([^>]*\\br="${cellRef}"[^>]*)(?:\\/>|>[\\s\\S]*?<\\/c>)`,
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
const downloadExcelFile = (data: Uint8Array | ArrayBuffer, fileName: string) => {
  const url = URL.createObjectURL(
    new Blob([data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
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
function QuoteBilingual({ zh, en }: { zh: string; en: string }) {
  return (
    <span className="quoteBilingual">
      <span>{zh}</span>
      <small>{en}</small>
    </span>
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
  const [currency, setCurrency] = useState<"CNY" | "USD">("CNY");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [pairingSuggestion, setPairingSuggestion] =
    useState<PairingSuggestion | null>(null);
  const [pairingRemovalPrompt, setPairingRemovalPrompt] =
    useState<PairingRemovalPrompt | null>(null);
  const [quoteImportOpen, setQuoteImportOpen] = useState(false);
  const [quoteImportPreview, setQuoteImportPreview] =
    useState<QuoteImportPreview | null>(null);
  const [quoteImportError, setQuoteImportError] = useState("");
  const [quoteImporting, setQuoteImporting] = useState(false);
  const [importedProducts, setImportedProducts] = useState<Product[]>([]);
  const quoteImportTemplateRef = useRef<QuoteImportTemplate | null>(null);
  const [quoteImportPriceMode, setQuoteImportPriceMode] =
    useState<QuoteImportPriceMode>("vip");
  const [editor, setEditor] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);
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
        const category1 = o?.category1 || p.family;
        const category2 = o?.category2 || p.category;
        const name = o?.name || p.name;
        return {
          ...p,
          name,
          price:
            o?.price === undefined || o.price === null || o.price === ""
              ? p.price
              : Number(o.price),
          image,
          volume: o?.volume || "",
          stock: o?.stock ?? null,
          majorCategory: o?.majorCategory || getMajorCategory(p),
          category1,
          category2,
          category3: o?.category3 || "未细分",
          colorTag:
            isSpaceTheme(name, p.en)
              ? "银色"
              : category1 === "小玩具"
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
    [overrides, relations, storedCatalogProducts],
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
  const majorProducts = products.filter((p) =>
    navigationMajorMembers(activeMajor).includes(p.majorCategory),
  );
  const hasGlobalQuery = query.trim().length > 0;
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
    hasGlobalQuery
      ? products
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
      (hasGlobalQuery || category === "全部产品" || p.category2 === category) &&
      (hasGlobalQuery || !category3Filter || p.category3 === category3Filter) &&
      (hasGlobalQuery || navigationGroup === "all" ||
        (navigationGroup === "simulation" && p.category1 !== "小玩具") ||
        (navigationGroup === "toys" && p.category1 === "小玩具")) &&
      (!hasGlobalQuery ||
        `${p.sku}${p.name}${p.en}${p.majorCategory}${p.category1}${p.category2}${p.category3}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())) &&
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
          : category3Filter
            ? `${category} · ${category3Filter}`
            : category;
  const quoteProducts = [...products, ...importedProducts];
  const cartItems = quoteProducts
    .filter((p) => cart[p.id])
    .map((p) => ({ ...p, qty: cart[p.id] }))
    .sort(
      (a, b) =>
        (a.importSourceRow !== undefined && b.importSourceRow !== undefined
          ? a.importSourceRow - b.importSourceRow
          : Number(a.category1 === "小玩具") - Number(b.category1 === "小玩具") ||
            a.sku.localeCompare(b.sku)),
    );
  const displayPrice = (p: Product) => (currency === "CNY" ? p.price : p.usd);
  const importCurrency = quoteImportPriceMode === "usd" ? "USD" : "CNY";
  const importUnitPrice = (product: Product) =>
    quoteImportPriceMode === "vip"
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
  ).map(([area, items]) => [
    area,
    [...items].sort(
      (a, b) =>
        (a.importSourceRow !== undefined && b.importSourceRow !== undefined
          ? a.importSourceRow - b.importSourceRow
          : Number(a.category1 === "小玩具") - Number(b.category1 === "小玩具") ||
            a.sku.localeCompare(b.sku)),
    ),
  ] as const);
  const quoteItemsInOrder = quoteGroups.flatMap(([, items]) => items);
  const preTax =
    subtotal +
    fees.packaging +
    fees.formaldehyde +
    fees.shipping +
    fees.installation;
  const tax = currency === "CNY" ? preTax * 0.13 : 0;
  const totalWithTax =
    preTax + tax - (showDesignDeduction ? fees.designDeduction : 0);
  const add = (id: string) => {
    const wasInCart = Boolean(cart[id]);
    setCart((x) => ({ ...x, [id]: (x[id] || 0) + 1 }));

    const source = products.find((product) => product.id === id);
    if (!source || source.category1 === "小玩具" || wasInCart) return;
    const relatedItems = relations
      .filter((relation) => relation.productId === id)
      .flatMap((relation) => {
        const product = products.find(
          (candidate) => candidate.id === relation.relatedProductId,
        );
        return product
          ? [{ product, quantity: Math.max(1, relation.quantity || 1) }]
          : [];
      });
    if (relatedItems.length) setPairingSuggestion({ source, relatedItems });
  };
  const clearQuotation = () => {
    setCart({});
    setImportedProducts([]);
    quoteImportTemplateRef.current = null;
    setPairingSuggestion(null);
    setPairingRemovalPrompt(null);
  };
  const addSuggestedPairing = () => {
    if (!pairingSuggestion) return;
    setCart((current) => {
      const next = { ...current };
      pairingSuggestion.relatedItems.forEach(({ product, quantity }) => {
        next[product.id] = (next[product.id] || 0) + quantity;
      });
      return next;
    });
    setPairingSuggestion(null);
  };
  const remove = (id: string) => {
    const product = quoteProducts.find((candidate) => candidate.id === id);
    const quantity = cart[id] || 0;
    if (!product || quantity <= 1) {
      const relatedItems = product
        ? relations
            .filter(
              (relation) =>
                relation.productId === id &&
                cart[relation.relatedProductId] &&
                products.find((candidate) => candidate.id === relation.relatedProductId)
                  ?.category1 === "小玩具",
            )
            .flatMap((relation) => {
              const relatedProduct = products.find(
                (candidate) => candidate.id === relation.relatedProductId,
              );
              return relatedProduct
                ? [{ product: relatedProduct, quantity: cart[relatedProduct.id] }]
                : [];
            })
        : [];
      if (product && product.category1 !== "小玩具" && relatedItems.length) {
        setPairingRemovalPrompt({ device: product, relatedItems });
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
        pairingRemovalPrompt.relatedItems.forEach(({ product }) => {
          next[product.id] = 0;
        });
      }
      return next;
    });
    setPairingRemovalPrompt(null);
  };
  const readQuoteImport = async (file: File) => {
    setQuoteImporting(true);
    setQuoteImportError("");
    setQuoteImportPreview(null);
    try {
      const source = await file.arrayBuffer();
      const workbook = XLSX.read(source, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("未找到可读取的工作表");
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
      const volumeColumn = findImportColumn(header, /体积|volume/i);
      const productBySku = new Map(
        products.map((product) => [product.sku.toUpperCase(), product]),
      );
      const importRows: Array<{ product: Product; quantity: number }> = [];
      const matched: Array<{ product: Product; quantity: number }> = [];
      const imported: Array<{ product: Product; quantity: number }> = [];
      const unmatchedSkus = new Set<string>();
      const workbookImages = extractWorkbookImages(source);
      let sourceRows = 0;
      let currentArea = "导入项目 / Imported items";
      rows.slice(headerIndex + 1).forEach((row, rowOffset) => {
        const skus = importedSkuCodes(row[skuColumn]);
        const rawQuantity = importCellNumber(row[quantityColumn]);
        const sourceName = importCellText(row[nameColumn]);
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
        const quantity = rawQuantity !== null && rawQuantity > 0 ? rawQuantity : 1;
        const sourceImageId = importCellText(row[imageColumn]).match(/(ID_[A-F0-9]+)/i)?.[1];
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
          en: catalog?.en || "",
          category: currentArea,
          family: catalog?.family || ("大型设备" as const),
          price: catalog?.price ?? cnyUnitPrice,
          priceNote: "来自导入报价表",
          usd: catalog?.usd ?? usdUnitPrice,
          unit: importCellText(row[unitColumn]) || catalog?.unit || "",
          spec: importCellText(row[specificationColumn]) || catalog?.spec || "",
          brand: importCellText(row[brandColumn]) || catalog?.brand || "YIFUN",
          material: catalog?.material || "",
          note: importCellText(row[noteColumn]) || catalog?.note || "",
          image: (sourceImageId ? workbookImages.get(sourceImageId) : "") || catalog?.image || "",
          volume: importCellText(row[volumeColumn]) || catalog?.volume || "",
          stock: catalog?.stock ?? null,
          majorCategory: catalog?.majorCategory || ("生活场景 / Lifestyle Scene" as MajorCategory),
          category1: catalog?.category1 || "导入项目",
          category2: catalog?.category2 || currentArea,
          category3: catalog?.category3 || "未细分",
          colorTag: importCellText(row[colorColumn]) || catalog?.colorTag || "待确认",
          hasScreen: catalog?.hasScreen || false,
          isRecommended: catalog?.isRecommended || false,
          relatedIds: [],
          importArea: currentArea,
          importSourceRow: headerIndex + rowOffset + 2,
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
      setQuoteImportPreview({
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
        source,
        fileName: file.name,
        columns: {
          quantity: quantityColumn,
          cnyUnit: cnyUnitColumn,
          cnyAmount: cnyAmountColumn,
          usdUnit: usdUnitColumn,
          usdAmount: usdAmountColumn,
          areaSubtotal: areaSubtotalColumn,
        },
        totalRow:
          rows.findIndex(
            (row, rowIndex) =>
              rowIndex > headerIndex &&
              /总计.*含税|total.*tax/i.test(importCellText(row[nameColumn])),
          ) + 1 || undefined,
        metadata: {
          designer: findImportMetaLocation(rows, headerIndex, /设计师|designer/i),
          sales: findImportMetaLocation(rows, headerIndex, /商务|业务员|sales/i),
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
    setCurrency(importCurrency);
    const importedRows = quoteImportPreview.rows;
    setImportedProducts(importedRows.map(({ product }) => product));
    if (quoteImportPreview.projectName) setQuoteProject(quoteImportPreview.projectName);
    if (quoteImportPreview.designerName) setDesignerName(quoteImportPreview.designerName);
    if (quoteImportPreview.salesName) setSalesName(quoteImportPreview.salesName);
    setCart(
      Object.fromEntries(
        importedRows.map(({ product, quantity }) => [product.id, quantity]),
      ),
    );
    setQuoteImportOpen(false);
    setCartOpen(true);
  };
  const exportImportedQuoteTemplate = () => {
    const template = quoteImportTemplateRef.current;
    if (!template || !importedProducts.length) return false;
    try {
      const files = unzipSync(new Uint8Array(template.source));
      const worksheetPath = Object.keys(files).find((path) =>
        /^xl\/worksheets\/sheet\d+\.xml$/.test(path),
      );
      if (!worksheetPath || !files[worksheetPath]) return false;
      let xml = strFromU8(files[worksheetPath]);
      const setCell = (row: number, column: number, value: string | number | null) => {
        if (column < 0 || value === null) return;
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
          importedProducts
            .filter((product) => product.importSourceRow !== undefined)
            .map((product) => [product.importSourceRow!, product]),
        ).values(),
      ].sort((a, b) => a.importSourceRow! - b.importSourceRow!);
      const columnName = (column: number) => XLSX.utils.encode_col(column);
      sourceLines.forEach((product) => {
        const row = product.importSourceRow!;
        const quantity = cart[product.id] || 0;
        setCell(row, template.columns.quantity, quantity);
        setCell(row, template.columns.cnyUnit, product.price);
        setCell(row, template.columns.usdUnit, product.usd);
        if (template.columns.cnyUnit >= 0 && template.columns.cnyAmount >= 0)
          setFormula(
            row,
            template.columns.cnyAmount,
            `=${columnName(template.columns.quantity)}${row}*${columnName(template.columns.cnyUnit)}${row}`,
            (product.price || 0) * quantity,
          );
        if (template.columns.usdUnit >= 0 && template.columns.usdAmount >= 0)
          setFormula(
            row,
            template.columns.usdAmount,
            `=${columnName(template.columns.quantity)}${row}*${columnName(template.columns.usdUnit)}${row}`,
            (product.usd || 0) * quantity,
          );
      });
      const amountColumn =
        template.columns.usdAmount >= 0
          ? template.columns.usdAmount
          : template.columns.cnyAmount;
      const amountValue = (product: Product) =>
        (amountColumn === template.columns.usdAmount ? product.usd : product.price) || 0;
      Object.values(
        sourceLines.reduce<Record<string, Product[]>>((groups, product) => {
          (groups[product.importArea || "导入项目"] ||= []).push(product);
          return groups;
        }, {}),
      ).forEach((areaLines) => {
        const firstRow = areaLines[0].importSourceRow!;
        const lastRow = areaLines.at(-1)!.importSourceRow!;
        setFormula(
          firstRow,
          template.columns.areaSubtotal,
          `=SUM(${columnName(amountColumn)}${firstRow}:${columnName(amountColumn)}${lastRow})`,
          areaLines.reduce(
            (total, product) => total + amountValue(product) * (cart[product.id] || 0),
            0,
          ),
        );
      });
      if (template.totalRow && sourceLines.length) {
        const firstRow = sourceLines[0].importSourceRow!;
        const lastRow = sourceLines.at(-1)!.importSourceRow!;
        const cnyTotal = sourceLines.reduce(
          (total, product) => total + (product.price || 0) * (cart[product.id] || 0),
          0,
        );
        const usdTotal = sourceLines.reduce(
          (total, product) => total + (product.usd || 0) * (cart[product.id] || 0),
          0,
        );
        setFormula(
          template.totalRow,
          template.columns.cnyAmount,
          `=SUM(${columnName(template.columns.cnyAmount)}${firstRow}:${columnName(template.columns.cnyAmount)}${lastRow})*(1+13%)`,
          cnyTotal * 1.13,
        );
        setFormula(
          template.totalRow,
          template.columns.usdAmount,
          `=SUM(${columnName(template.columns.usdAmount)}${firstRow}:${columnName(template.columns.usdAmount)}${lastRow})`,
          usdTotal,
        );
      }
      if (template.metadata.designer)
        setCell(
          template.metadata.designer.row + 1,
          template.metadata.designer.column,
          designerName,
        );
      if (template.metadata.sales)
        setCell(
          template.metadata.sales.row + 1,
          template.metadata.sales.column,
          salesName,
        );
      files[worksheetPath] = strToU8(xml);
      const fileName = `${template.fileName.replace(/\.(xlsx|xls|csv)$/i, "")}_报价清单.xlsx`;
      downloadExcelFile(zipSync(files, { level: 6 }), fileName);
      return true;
    } catch {
      return false;
    }
  };
  const exportQuoteExcel = () => {
    if (exportImportedQuoteTemplate()) return;
    const unitPriceTitle = currency === "USD" ? "USD Unit Price" : "CNY Unit Price";
    const amountTitle = currency === "USD" ? "USD Amount" : "CNY Amount";
    const headers = [
      "Area / 区域",
      "SKU / 款号",
      "Product / 产品名称",
      "English Name / 英文名称",
      "Brand / 品牌",
      "Specification / 规格尺寸",
      "Unit / 单位",
      "Qty / 数量",
      unitPriceTitle,
      amountTitle,
      "Colour / 颜色",
      "Volume / 体积",
      "Remarks / 备注",
      "Image URL / 图片链接",
    ];
    const rows: Array<Array<string | number>> = [
      ["亦玩集团产品报价清单 / Yifun Life Product Quotation"],
      ["项目名称 / Project", quoteProject, "设计师 / Designer", designerName, "业务员 / Sales", salesName],
      ["报价币种 / Currency", currency, "报价日期 / Date", new Date().toLocaleDateString("zh-CN")],
      headers,
    ];
    const productRows: number[] = [];
    quoteGroups.forEach(([area, items]) => {
      rows.push([area]);
      items.forEach((product) => {
        const rowNumber = rows.length + 1;
        productRows.push(rowNumber);
        rows.push([
          area,
          product.sku,
          product.name,
          englishProductName(product),
          product.brand || "YIFUN",
          product.spec || "—",
          unitLabel(product.unit).zh,
          product.qty,
          displayPrice(product) ?? "",
          "",
          colourLabel(product.colorTag).zh,
          product.volume || "—",
          product.note || "—",
          product.image || "",
        ]);
      });
    });
    const feeRows = [
      ["包装费 / Packaging fee", fees.packaging],
      ["除甲醛 / Formaldehyde removal", fees.formaldehyde],
      ["运输费 / Shipping fee", fees.shipping],
      ["安装费 / Installation fee", fees.installation],
    ];
    rows.push([]);
    feeRows.forEach(([label, amount]) => rows.push([label, "", "", "", "", "", "", "", "", amount]));
    const subtotalRow = rows.length + 1;
    rows.push(["小计（不含税） / Subtotal (tax excluded)"]);
    const taxRow = rows.length + 1;
    rows.push(["税额 13% / Tax 13%"]);
    const designRow = rows.length + 1;
    rows.push(["设计费抵扣 / Design fee deduction"]);
    const totalRow = rows.length + 1;
    rows.push(["总计（含税） / Total (tax included)"]);

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    productRows.forEach((rowNumber) => {
      sheet[`J${rowNumber}`] = {
        t: "n",
        f: `IF(I${rowNumber}=\"\",\"\",H${rowNumber}*I${rowNumber})`,
        z: currency === "USD" ? "$#,##0.00" : "¥#,##0",
      };
    });
    const firstProductRow = productRows[0] || 5;
    const lastProductRow = productRows.at(-1) || firstProductRow;
    const firstFeeRow = subtotalRow - feeRows.length;
    sheet[`J${subtotalRow}`] = {
      t: "n",
      f: `SUM(J${firstProductRow}:J${lastProductRow})+SUM(J${firstFeeRow}:J${subtotalRow - 1})`,
      z: currency === "USD" ? "$#,##0.00" : "¥#,##0",
    };
    sheet[`J${taxRow}`] = {
      t: "n",
      f: currency === "CNY" ? `J${subtotalRow}*13%` : "0",
      z: currency === "USD" ? "$#,##0.00" : "¥#,##0",
    };
    sheet[`J${designRow}`] = {
      t: "n",
      v: showDesignDeduction ? fees.designDeduction : 0,
      z: currency === "USD" ? "$#,##0.00" : "¥#,##0",
    };
    sheet[`J${totalRow}`] = {
      t: "n",
      f: `J${subtotalRow}+J${taxRow}-J${designRow}`,
      z: currency === "USD" ? "$#,##0.00" : "¥#,##0",
    };
    sheet["!merges"] = [
      XLSX.utils.decode_range("A1:N1"),
    ];
    sheet["!cols"] = [
      { wch: 26 }, { wch: 14 }, { wch: 26 }, { wch: 28 }, { wch: 20 },
      { wch: 24 }, { wch: 13 }, { wch: 10 }, { wch: 15 }, { wch: 15 },
      { wch: 14 }, { wch: 13 }, { wch: 24 }, { wch: 42 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "报价清单");
    const fileName = `${(quoteProject || "Yifun_Life_Quotation").replace(/[^\w\u4e00-\u9fff-]+/g, "_")}_${currency}.xlsx`;
    XLSX.writeFile(workbook, fileName, { compression: true });
  };
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
    const colorTag =
      isSpaceTheme(draft.name, draft.en)
        ? "银色"
        : draft.category1 === "模拟设备" && draft.category2 === "消防区设备"
        ? "红"
        : normalizeColorTag(draft.colorTag);
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
      colorTag,
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
          <a className="loginBrand" href="/" aria-label="返回主页">
            <CompanyLogo className="loginLogo" />
          </a>
          <p>正在验证访问权限…</p>
        </div>
      </main>
    );
  if (auth === "signedOut")
    return (
      <main className="loginShell">
        <form className="loginCard" onSubmit={login}>
          <a className="loginBrand" href="/" aria-label="返回主页">
            <CompanyLogo className="loginLogo" />
          </a>
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
          <button
            className="outline"
            onClick={() => window.open("/product-pairing", "_blank", "noopener")}
          >
            玩具配对管理
          </button>
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
                      setCategory3Filter("");
                      setSelectedCategoryKey("");
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
                        {
                          key: "simulation" as const,
                          name: "模拟区",
                          matches: (p: Product) =>
                            unpairedNavigationMajors.has(major) ||
                            p.category1 !== "小玩具",
                        },
                        {
                          key: "toys" as const,
                          name: "配套玩具",
                          matches: (p: Product) => p.category1 === "小玩具",
                        },
                      ]).filter(
                        (section) =>
                          section.key !== "toys" ||
                          !unpairedNavigationMajors.has(major),
                      ).map((section) => {
                        const sectionProducts = products.filter(
                          (p) =>
                            navigationMajorMembers(major).includes(
                              p.majorCategory,
                            ) && section.matches(p),
                        );
                        const pairedCategories =
                          section.key === "toys" ? pairedAreasForMajor(major) : [];
                        const sectionCategories = [...new Set([
                          ...pairedCategories,
                          ...sectionProducts
                            .map((p) => p.category2)
                            .filter(
                              (categoryName) =>
                                !pairedCategories.includes(categoryName),
                            ),
                        ])];
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
                                const categoryProducts = sectionProducts.filter(
                                  (p) => p.category2 === c,
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
                                        {["必配", "选配"].map((tier) => (
                                          <button
                                            className={
                                              selectedCategoryKey === `toys:${c}` &&
                                              category3Filter === tier
                                                ? "on"
                                                : ""
                                            }
                                            key={tier}
                                            onClick={() => {
                                              setCategory(c);
                                              setCategory3Filter(tier);
                                              setSelectedCategoryKey(`toys:${c}`);
                                              setNavigationGroup("toys");
                                            }}
                                          >
                                            {tier}
                                            <span>
                                              {
                                                categoryProducts.filter(
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
            <small>八大类映射已写入产品库</small>
          </div>
        </aside>
        <section className="catalog">
          <div className="catalogHead">
            <div>
              <span className="eyebrow">
                {hasGlobalQuery ? "全局搜索 / Global Search" : activeMajor} ·{" "}
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
                        <p className={`en${needsEnglishTranslation(p) ? " missingEnglish" : ""}`}>
                          {englishProductName(p)}
                        </p>
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
      {pairingSuggestion && (
        <aside className="pairingSuggestion" aria-live="polite">
          <button
            className="pairingSuggestionClose"
            aria-label="关闭关联玩具提示"
            onClick={() => setPairingSuggestion(null)}
          >
            ×
          </button>
          <p>关联玩具 / PAIRED TOYS</p>
          <h3>{pairingSuggestion.source.sku} 已加入报价单</h3>
          <span>
            已固定配对 {pairingSuggestion.relatedItems.length} 个玩具，是否一起加入？
          </span>
          <small>
            {pairingSuggestion.relatedItems
              .slice(0, 3)
              .map(({ product }) => product.sku)
              .join(" · ")}
            {pairingSuggestion.relatedItems.length > 3 ? " …" : ""}
          </small>
          <div className="pairingSuggestionActions">
            <button
              className="outline"
              onClick={() => setPairingSuggestion(null)}
            >
              暂不加入
            </button>
            <button className="primary" onClick={addSuggestedPairing}>
              加入 {pairingSuggestion.relatedItems.length} 个玩具
            </button>
          </div>
        </aside>
      )}
      {pairingRemovalPrompt && (
        <aside className="pairingSuggestion pairingRemovalPrompt" aria-live="assertive">
          <p>关联玩具 / PAIRED TOYS</p>
          <h3>删除 {pairingRemovalPrompt.device.sku}？</h3>
          <span>
            该设备已配对 {pairingRemovalPrompt.relatedItems.length} 个、且已加入报价单的玩具。
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
              保留玩具
            </button>
            <button className="primary" onClick={() => removePairedDevice(true)}>
              一并删除玩具
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
                  <option value="factory" disabled>
                    出厂价（CNY）— 暂未维护
                  </option>
                  <option value="vip">国内 VIP 价格（CNY）</option>
                  <option value="usd">美金价格（USD）</option>
                </select>
                <small>
                  当前默认使用国内 VIP 价格；出厂价资料补齐后可在此启用。
                </small>
              </label>
              <label className="importDropzone">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readQuoteImport(file);
                    event.currentTarget.value = "";
                  }}
                />
                <b>{quoteImporting ? "正在读取表单…" : "选择 Excel 表单"}</b>
                <small>支持 .xlsx、.xls、.csv；未匹配款号会保留在核对清单中。</small>
              </label>
              {quoteImportError && <p className="importError">{quoteImportError}</p>}
              {quoteImportPreview && (
                <section className="importResult">
                  <div>
                    <b>{quoteImportPreview.fileName}</b>
                    <span>
                      已读取 {quoteImportPreview.sourceRows} 行 · 匹配 {quoteImportPreview.matched.length} 个 SKU · 补入 {quoteImportPreview.imported.length} 个导入项目
                    </span>
                  </div>
                  <div className="importMetadata">
                    <span>项目名称：{quoteImportPreview.projectName || "表单未提供"}</span>
                    <span>设计师：{quoteImportPreview.designerName || "表单未提供"}</span>
                    <span>商务：{quoteImportPreview.salesName || "表单未提供"}</span>
                  </div>
                  <p>
                    下表金额已按 {quoteImportPriceMode === "usd" ? "美金价格（USD）" : "国内 VIP 价格（CNY）"} 计算。
                  </p>
                  <div className="importTableWrap">
                    <table className="importTable">
                      <thead>
                        <tr>
                          <th>款号 / SKU</th>
                          <th>区域 / Area</th>
                          <th>产品名称 / Product</th>
                          <th>图片 / Image</th>
                          <th>规格尺寸 / Size</th>
                          <th>数量 / Qty</th>
                          <th>单价 / Unit price</th>
                          <th>金额 / Amount</th>
                          <th>颜色 / Colour</th>
                          <th>备注 / Remarks</th>
                          <th>体积 / Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quoteImportPreview.rows.map(({ product, quantity }) => {
                          const unitPrice = importUnitPrice(product);
                          return (
                            <tr key={product.id}>
                              <td><b>{product.sku}</b></td>
                              <td>{product.importArea || "—"}</td>
                              <td>{product.name}</td>
                              <td>
                                {product.image ? (
                                  <img src={product.image} alt={product.name} />
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td>{product.spec || "—"}</td>
                              <td>{quantity}</td>
                              <td>{formatImportPrice(unitPrice)}</td>
                              <td>{formatImportPrice(unitPrice === null ? null : unitPrice * quantity)}</td>
                              <td>{colourLabel(product.colorTag).zh}</td>
                              <td>{product.note || "—"}</td>
                              <td>{product.volume || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {quoteImportPreview.unmatchedSkus.length > 0 && (
                    <div className="importUnmatched">
                      <b>产品库未收录 {quoteImportPreview.unmatchedSkus.length} 个款号，已按表单资料补入报价单</b>
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
                      {[...new Set(
                        categories
                          .filter(
                            (c) =>
                              c.level === 3 &&
                              c.parentKey ===
                                `${draft.category1}/${draft.category2}`,
                          )
                          .map((c) => c.name),
                      )].map((name) => (
                        <option key={name}>{name}</option>
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
                    <small className={needsEnglishTranslation(p) ? "missingEnglish" : ""}>
                      {englishProductName(p)}
                    </small>
                    <small className="cartSku">{p.sku}</small>
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
                      onClick={() => remove(p.id)}
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
              <div className="cartFootActions">
                <button className="outline clearQuotation" onClick={clearQuotation}>
                  ⟲ 一键清除清单
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    setCartOpen(false);
                    setQuoteOpen(true);
                  }}
                >
                  生成报价单
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
                <button className="outline" onClick={() => setQuoteOpen(false)}>
                  返回编辑 / Back
                </button>
                <button className="outline" onClick={exportQuoteExcel}>
                  导出 Excel / Export Excel
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
                    <th className="quoteSerialHeader">
                      <span>序号</span>
                      <span>No.</span>
                    </th>
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
                      const serial = quoteItemsInOrder.indexOf(p) + 1;
                      return (
                        <tr key={p.id}>
                          <td>{serial}</td>
                          <td className="quoteSku">{p.sku || "—"}</td>
                          <td>
                            <b>{p.name}</b>
                            <small className={needsEnglishTranslation(p) ? "missingEnglish" : ""}>
                              {englishProductName(p)}
                            </small>
                          </td>
                          <td>
                            <div className="quoteImage">
                              <Visual p={p} mini />
                            </div>
                          </td>
                          <td>{p.brand || "YIFUN"}</td>
                          <td>{p.spec || "—"}</td>
                          <td>
                            <QuoteBilingual {...unitLabel(p.unit)} />
                          </td>
                          <td>{p.qty}</td>
                          <td>{money(unitPrice, currency)}</td>
                          <td>{money(amount, currency)}</td>
                          <td>
                            <QuoteBilingual {...colourLabel(p.colorTag)} />
                          </td>
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
