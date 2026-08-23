"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CellValueChangedEvent,
  ColDef,
  ICellEditorParams,
  ICellRendererParams,
  SelectionChangedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { CatalogProduct } from "../catalog-types";
import { pairedArea } from "../../lib/area-pairing";

type Override = {
  productId: string;
  price?: string | null;
  imageUrl?: string | null;
  category1?: string | null;
  category2?: string | null;
  category3?: string | null;
  colorTag?: string | null;
};

type Category = {
  level: number;
  parentKey: string;
  name: string;
};

type ProductRelation = {
  productId: string;
  relatedProductId: string;
  quantity?: number | string;
};

type AreaPairingRule = {
  id: string;
  name: string;
  selectionMode: "fixed" | "single" | "multiple";
  minSelections: number;
  maxSelections: number;
  note: string;
  items: Array<{ sku: string; quantity: number }>;
};

type StoredAreaPairingRule = {
  area: string;
  rules: AreaPairingRule[];
  updatedAt: string;
};

type GridRow = {
  id: string;
  image: string;
  sku: string;
  productName: string;
  category1: string;
  category2: string;
  category3: string;
  categoryPath: string;
  colorTag: string;
  price: number | null;
  note: string;
  name: string;
  en: string;
};

type UndoItem = {
  productId: string;
  sku: string;
  patch: Record<string, string>;
  restoreRow: GridRow;
};

type UndoChange = {
  label: string;
  items: UndoItem[];
};

const colorChoices = [
  "不适用",
  "红",
  "粉",
  "黄",
  "蓝",
  "黑",
  "白",
  "银色",
  "橙",
  "绿",
  "紫",
  "待重新识别",
  "未识别",
  "无主图",
];

const colorSwatches: Record<string, string> = {
  红: "#d83d48", 粉: "#ef9a9a", 黄: "#ddbd26", 蓝: "#2f7eb9",
  黑: "#1c242d", 白: "#ffffff", 银色: "#b9bec4", 橙: "#e9812f",
  绿: "#3f9862", 紫: "#8756b6", 不适用: "#b9c3bd",
  待重新识别: "#d7b55f", 未识别: "#d7b55f", 无主图: "#c9cfca",
};

const kitchenAreaPairingRules: AreaPairingRule[] = [
  {
    id: "kitchen-essentials",
    name: "厨房基础必配",
    selectionMode: "fixed",
    minSelections: 3,
    maxSelections: 3,
    note: "每厨房位：厨师服、挂钩、厨具五件套各 1 套。",
    items: [
      { sku: "Y30787", quantity: 1 },
      { sku: "Y40708", quantity: 1 },
      { sku: "Y40655", quantity: 1 },
    ],
  },
  {
    id: "kitchen-condiments",
    name: "调料组合",
    selectionMode: "single",
    minSelections: 1,
    maxSelections: 1,
    note: "每厨房位选择 1 套。",
    items: [
      { sku: "Y40611", quantity: 1 },
      { sku: "Y30786", quantity: 1 },
    ],
  },
  {
    id: "kitchen-tableware",
    name: "餐具组合",
    selectionMode: "multiple",
    minSelections: 2,
    maxSelections: 2,
    note: "每厨房位选择 2 种餐具，每种 1 套。",
    items: [
      { sku: "Y30729", quantity: 1 },
      { sku: "Y31190", quantity: 1 },
      { sku: "Y30733", quantity: 1 },
      { sku: "Y30734", quantity: 1 },
      { sku: "Y30719", quantity: 1 },
    ],
  },
];

function ColourDot({ value }: { value: string }) {
  return (
    <span
      className="gridColourDot"
      style={{ background: colorSwatches[value] || "#b9c3bd" }}
      aria-hidden="true"
    />
  );
}

type PickerEditorProps = ICellEditorParams<GridRow, string> & {
  values: string[];
  showColour?: boolean;
};

const PickerEditor = forwardRef<{ getValue: () => string }, PickerEditorProps>(
  ({ value, values, showColour, stopEditing }, ref) => {
    const selected = useRef(String(value || ""));
    useImperativeHandle(ref, () => ({ getValue: () => selected.current }));
    return (
      <div className="gridPicker" role="listbox">
        {values.map((option) => (
          <button
            className={option === selected.current ? "selected" : ""}
            key={option}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              selected.current = option;
              stopEditing();
            }}
            type="button"
          >
            {showColour && <ColourDot value={option} />}
            <span>{option}</span>
          </button>
        ))}
      </div>
    );
  },
);
PickerEditor.displayName = "PickerEditor";

const categoryPath = (category1: string, category2: string, category3: string) =>
  [category1, category2, category3].filter(Boolean).join(" / ");

const pairingAreaForRow = (row: GridRow) =>
  pairedArea(row.category2, row.productName) || row.category2;

const normalizedRelation = (relation: ProductRelation): ProductRelation => ({
  ...relation,
  quantity: Math.max(1, Math.floor(Number(relation.quantity) || 1)),
});

const normalizedSku = (value: string) =>
  value.trim().toUpperCase().match(/Y\d+/)?.[0] || value.trim().toUpperCase();

const relationQuantityTotal = (relations: ProductRelation[]) =>
  relations.reduce(
    (total, relation) => total + Math.max(1, Math.floor(Number(relation.quantity) || 1)),
    0,
  );

const gridRows = (products: CatalogProduct[], overrides: Override[]): GridRow[] => {
  const overrideById = new Map(overrides.map((override) => [override.productId, override]));
  return products.map((product) => {
    const override = overrideById.get(product.id);
    const category1 = override?.category1 || product.family;
    const category2 = override?.category2 || product.category;
    const category3 = override?.category3 || "未细分";
    return {
      id: product.id,
      image: override?.imageUrl || product.image,
      sku: product.sku,
      productName: product.name,
      category1,
      category2,
      category3,
      categoryPath: categoryPath(category1, category2, category3),
      colorTag:
        category1 === "小玩具"
          ? "不适用"
          : override?.colorTag || (product.image ? "待重新识别" : "无主图"),
      price:
        override?.price === undefined || override.price === null || override.price === ""
          ? product.price
          : Number(override.price),
      note: product.note || product.priceNote,
      name: product.name,
      en: product.en,
    };
  });
};

export function ProductGridManager() {
  const [rows, setRows] = useState<GridRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("正在加载产品清单…");
  const [undoStack, setUndoStack] = useState<UndoChange[]>([]);
  const [selectedRows, setSelectedRows] = useState<GridRow[]>([]);
  const [batchCategory1, setBatchCategory1] = useState("");
  const [batchCategory2, setBatchCategory2] = useState("");
  const [batchCategory3, setBatchCategory3] = useState("");
  const [relations, setRelations] = useState<ProductRelation[]>([]);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingCategory, setPairingCategory] = useState("");
  const [pairingSourceId, setPairingSourceId] = useState("");
  const [pairingTargetIds, setPairingTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const [pairingQuantities, setPairingQuantities] = useState<Record<string, number>>({});
  const [areaPairingRules, setAreaPairingRules] = useState<StoredAreaPairingRule[]>([]);
  const [pairingSearch, setPairingSearch] = useState("");
  const [pairingSaving, setPairingSaving] = useState(false);
  const [areaRuleSaving, setAreaRuleSaving] = useState(false);
  const [areaRuleApplying, setAreaRuleApplying] = useState(false);
  const [pairingSavedMessage, setPairingSavedMessage] = useState("");

  const load = async () => {
    const response = await fetch("/api/catalog");
    if (!response.ok) {
      setStatus("无法加载产品清单，请返回主页面重新登录。");
      return;
    }
    const data = await response.json();
    setRows(gridRows(data.products || [], data.overrides || []));
    setCategories(data.categories || []);
    setRelations((data.recommendations || []).map(normalizedRelation));
    setAreaPairingRules(data.areaPairingRules || []);
    setStatus(`${(data.products || []).length} 个 SKU · 双击分类或颜色即可修改`);
  };

  useEffect(() => {
    void load();
  }, []);

  const categoryPaths = useMemo(
    () =>
      [...new Set([
        ...rows.map((row) => row.categoryPath),
        ...categories
          .filter((category) => category.level === 3)
          .map((category) => `${category.parentKey.replace("/", " / ")} / ${category.name}`),
      ])].sort(),
    [categories, rows],
  );

  const batchCategory1Options = useMemo(
    () => [...new Set(rows.map((row) => row.category1))].sort(),
    [rows],
  );
  const batchCategory2Options = useMemo(
    () =>
      [...new Set([
        ...rows
          .filter((row) => row.category1 === batchCategory1)
          .map((row) => row.category2),
        ...categories
          .filter(
            (category) =>
              category.level === 2 && category.parentKey === batchCategory1,
          )
          .map((category) => category.name),
      ])].sort(),
    [batchCategory1, categories, rows],
  );
  const batchCategory3Options = useMemo(
    () =>
      [...new Set([
        ...rows
          .filter(
            (row) =>
              row.category1 === batchCategory1 &&
              row.category2 === batchCategory2,
          )
          .map((row) => row.category3),
        ...categories
          .filter(
            (category) =>
              category.level === 3 &&
              category.parentKey === `${batchCategory1}/${batchCategory2}`,
          )
          .map((category) => category.name),
      ])].sort(),
    [batchCategory1, batchCategory2, categories, rows],
  );

  const pairingToyAreas = useMemo(
    () => new Set(
      rows
        .filter((row) => row.category1 === "小玩具")
        .map(pairingAreaForRow),
    ),
    [rows],
  );
  const simulationCategories = useMemo(
    () =>
      [...new Set(
        rows
          .filter(
            (row) =>
              row.category1 !== "小玩具" &&
              pairingToyAreas.has(pairingAreaForRow(row)),
          )
          .map(pairingAreaForRow),
      )].sort(),
    [pairingToyAreas, rows],
  );
  const pairingSimulationRows = useMemo(
    () => {
      const query = pairingSearch.trim().toLowerCase();
      return rows.filter((row) =>
        row.category1 !== "小玩具" &&
        pairingToyAreas.has(pairingAreaForRow(row)) &&
        (query
          ? `${row.productName} ${row.en} ${row.sku}`.toLowerCase().includes(query)
          : pairingAreaForRow(row) === pairingCategory),
      );
    },
    [pairingCategory, pairingSearch, pairingToyAreas, rows],
  );
  const pairingToyRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.category1 === "小玩具" &&
          pairingAreaForRow(row) === pairingCategory,
      ),
    [pairingCategory, rows],
  );
  const pairingCountsBySourceId = useMemo(() => {
    const counts = new Map<string, number>();
    relations.forEach((relation) => {
      counts.set(relation.productId, (counts.get(relation.productId) || 0) + 1);
    });
    return counts;
  }, [relations]);
  const selectedToyQuantity = useMemo(
    () =>
      [...pairingTargetIds].reduce(
        (total, productId) => total + (pairingQuantities[productId] || 1),
        0,
      ),
    [pairingQuantities, pairingTargetIds],
  );
  const savedKitchenRules = useMemo(
    () => areaPairingRules.find((rule) => rule.area === "厨房区"),
    [areaPairingRules],
  );

  const saveKitchenAreaRules = async () => {
    setAreaRuleSaving(true);
    setPairingSavedMessage("");
    const response = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "areaPairingRules",
        area: "厨房区",
        rules: kitchenAreaPairingRules,
      }),
    });
    if (!response.ok) {
      setAreaRuleSaving(false);
      setPairingSavedMessage("厨房统一规则保存失败，请重试。");
      return;
    }
    const data = (await response.json()) as { rule?: StoredAreaPairingRule };
    if (data.rule)
      setAreaPairingRules((current) => [
        ...current.filter((rule) => rule.area !== data.rule!.area),
        data.rule!,
      ]);
    setAreaRuleSaving(false);
    setPairingSavedMessage("厨房区统一配对规则已保存，全部厨房模拟设备共用此逻辑。");
  };

  const applyKitchenAreaRules = async () => {
    setAreaRuleApplying(true);
    setPairingSavedMessage("");
    const ruleSkus = new Set(
      kitchenAreaPairingRules.flatMap((rule) =>
        rule.items.map((item) => normalizedSku(item.sku)),
      ),
    );
    const sources = rows.filter(
      (row) => row.category1 !== "小玩具" && pairingAreaForRow(row) === "厨房区",
    );
    const targets = rows.filter((row) => ruleSkus.has(normalizedSku(row.sku)));
    if (!sources.length || !targets.length) {
      setAreaRuleApplying(false);
      setPairingSavedMessage("未找到可应用的厨房设备或玩具 SKU。");
      return;
    }
    const relatedProducts = targets.map((target) => ({
      relatedProductId: target.id,
      quantity: 1,
    }));
    const results = await Promise.all(
      sources.map((source) =>
        fetch("/api/catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "recommendations",
            productId: source.id,
            relatedProducts,
          }),
        }),
      ),
    );
    setAreaRuleApplying(false);
    if (results.some((response) => !response.ok)) {
      setPairingSavedMessage("厨房配对应用失败，请重试。");
      return;
    }
    await load();
    setPairingSavedMessage(
      `已将 ${targets.length} 个玩具（每个 ×1）保存到 ${sources.length} 台厨房模拟设备，共 ${sources.length * targets.length} 条配对。`,
    );
  };

  const openPairingManager = () => {
    setPairingCategory((current) => current || simulationCategories[0] || "");
    setPairingSourceId("");
    setPairingTargetIds(new Set());
    setPairingQuantities({});
    setPairingSearch("");
    setPairingSavedMessage("");
    setPairingOpen(true);
  };

  const selectPairingSource = (productId: string) => {
    const savedRelations = relations.filter(
      (relation) => relation.productId === productId,
    );
    setPairingSourceId(productId);
    setPairingTargetIds(
      new Set(
        savedRelations.map((relation) => relation.relatedProductId),
      ),
    );
    setPairingQuantities(
      Object.fromEntries(
        savedRelations.map((relation) => [
          relation.relatedProductId,
          relation.quantity || 1,
        ]),
      ),
    );
    setPairingSavedMessage(
      savedRelations.length
        ? `已载入 ${savedRelations.length} 个已保存配套玩具，总数量 ${relationQuantityTotal(savedRelations)}。`
        : "该模拟产品暂未保存配套玩具。",
    );
  };

  const togglePairingTarget = (productId: string) => {
    setPairingTargetIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setPairingQuantities((current) => {
      const next = { ...current };
      if (next[productId]) delete next[productId];
      else next[productId] = 1;
      return next;
    });
  };

  const setPairingQuantity = (productId: string, value: number) => {
    const quantity = Math.max(0, Math.floor(Number(value) || 0));
    setPairingTargetIds((current) => {
      const next = new Set(current);
      if (quantity) next.add(productId);
      else next.delete(productId);
      return next;
    });
    setPairingQuantities((current) => {
      const next = { ...current };
      if (quantity) next[productId] = quantity;
      else delete next[productId];
      return next;
    });
  };

  const savePairing = async () => {
    if (!pairingSourceId) return;
    setPairingSaving(true);
    const response = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "recommendations",
        productId: pairingSourceId,
        relatedProducts: [...pairingTargetIds].map((relatedProductId) => ({
          relatedProductId,
          quantity: pairingQuantities[relatedProductId] || 1,
        })),
      }),
    });
    if (!response.ok) {
      setPairingSaving(false);
      setStatus("配对保存失败，请重试。");
      return;
    }
    const data = (await response.json()) as {
      recommendations?: ProductRelation[];
    };
    const savedRelations = (data.recommendations || []).map(normalizedRelation);
    setPairingSaving(false);
    setRelations((current) => [
      ...current.filter((relation) => relation.productId !== pairingSourceId),
      ...savedRelations,
    ]);
    const savedQuantity = relationQuantityTotal(savedRelations);
    setStatus(`已保存 ${savedRelations.length} 个配套玩具 · 总数量 ${savedQuantity}`);
    setPairingSavedMessage(
      `已保存 ${savedRelations.length} 个配套玩具，总数量 ${savedQuantity}。窗口会保持打开，方便你立即核对。`,
    );
  };

  const saveChange = async (event: CellValueChangedEvent<GridRow>) => {
    if (!event.data || event.newValue === event.oldValue) return;
    const field = event.colDef.field;
    let patch: Record<string, string>;
    let updatedRow = event.data;
    let undoItem: UndoItem;

    if (field === "categoryPath") {
      const [category1, category2, category3 = "未细分"] = String(event.newValue)
        .split(" / ");
      patch = { category1, category2, category3 };
      updatedRow = {
        ...event.data,
        category1,
        category2,
        category3,
        categoryPath: categoryPath(category1, category2, category3),
        colorTag: category1 === "小玩具" ? "不适用" : event.data.colorTag,
      };
      const [oldCategory1, oldCategory2, oldCategory3 = "未细分"] = String(
        event.oldValue,
      ).split(" / ");
      undoItem = {
        productId: event.data.id,
        sku: event.data.sku,
        patch: {
          category1: oldCategory1,
          category2: oldCategory2,
          category3: oldCategory3,
        },
        restoreRow: {
          ...event.data,
          category1: oldCategory1,
          category2: oldCategory2,
          category3: oldCategory3,
          categoryPath: categoryPath(oldCategory1, oldCategory2, oldCategory3),
        },
      };
    } else if (field === "colorTag") {
      patch = { colorTag: String(event.newValue) };
      updatedRow = { ...event.data, colorTag: String(event.newValue) };
      undoItem = {
        productId: event.data.id,
        sku: event.data.sku,
        patch: { colorTag: String(event.oldValue) },
        restoreRow: { ...event.data, colorTag: String(event.oldValue) },
      };
    } else {
      return;
    }

    setRows((current) =>
      current.map((row) => (row.id === event.data.id ? updatedRow : row)),
    );
    setStatus(`正在保存 ${event.data.sku}…`);
    const response = await fetch("/api/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: event.data.id, patch }),
    });
    if (response.ok) {
      setUndoStack((current) => [
        ...current,
        { label: event.data.sku, items: [undoItem] },
      ]);
      setStatus(`已保存 ${event.data.sku}`);
    } else {
      setRows((current) =>
        current.map((row) =>
          row.id === event.data.id ? undoItem.restoreRow : row,
        ),
      );
      setStatus(`未能保存 ${event.data.sku}，已恢复原值。`);
    }
  };

  const undoLastChange = async () => {
    const lastChange = undoStack.at(-1);
    if (!lastChange) return;
    setStatus(`正在撤销 ${lastChange.label}…`);
    for (const item of lastChange.items) {
      const response = await fetch("/api/catalog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: item.productId, patch: item.patch }),
      });
      if (!response.ok) {
        setStatus(`未能撤销 ${lastChange.label}，请重试。`);
        return;
      }
    }
    setRows((current) =>
      current.map((row) =>
        lastChange.items.find((item) => item.productId === row.id)?.restoreRow || row,
      ),
    );
    setUndoStack((current) => current.slice(0, -1));
    setStatus(`已撤销 ${lastChange.label} 的修改`);
  };

  const applyBatchCategory = async () => {
    if (
      !batchCategory1 ||
      !batchCategory2 ||
      !batchCategory3 ||
      !selectedRows.length
    )
      return;
    const category1 = batchCategory1;
    const category2 = batchCategory2;
    const category3 = batchCategory3;
    const updates = selectedRows.map((row) => ({
      productId: row.id,
      patch: { category1, category2, category3 },
      restoreRow: row,
      updatedRow: {
        ...row,
        category1,
        category2,
        category3,
        categoryPath: categoryPath(category1, category2, category3),
        colorTag: category1 === "小玩具" ? "不适用" : row.colorTag,
      },
    }));
    setStatus(`正在批量修改 ${updates.length} 个 SKU 的分类…`);
    for (let index = 0; index < updates.length; index += 20) {
      const results = await Promise.all(
        updates.slice(index, index + 20).map((update) =>
          fetch("/api/catalog", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: update.productId, patch: update.patch }),
          }),
        ),
      );
      if (results.some((response) => !response.ok)) {
        setStatus("部分 SKU 未能修改，未保存的项目请重试。");
        return;
      }
    }
    setRows((current) =>
      current.map(
        (row) => updates.find((update) => update.productId === row.id)?.updatedRow || row,
      ),
    );
    setUndoStack((current) => [
      ...current,
      {
        label: `${updates.length} 个 SKU 的批量分类`,
        items: updates.map((update) => ({
          productId: update.productId,
          sku: update.restoreRow.sku,
          patch: {
            category1: update.restoreRow.category1,
            category2: update.restoreRow.category2,
            category3: update.restoreRow.category3,
          },
          restoreRow: update.restoreRow,
        })),
      },
    ]);
    setBatchCategory1("");
    setBatchCategory2("");
    setBatchCategory3("");
    setStatus(`已批量修改 ${updates.length} 个 SKU 的分类`);
  };

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        headerName: "选择",
        width: 72,
        minWidth: 72,
        maxWidth: 72,
        checkboxSelection: true,
        headerCheckboxSelection: true,
        sortable: false,
        filter: false,
      },
      {
        headerName: "图片",
        field: "image",
        width: 86,
        minWidth: 86,
        maxWidth: 86,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<GridRow, string>) =>
          params.value ? (
            <img className="skuGridImage" src={params.value} alt="" />
          ) : (
            <span className="skuGridImageEmpty">暂无图</span>
          ),
      },
      { headerName: "SKU", field: "productName", minWidth: 180, flex: 1 },
      { headerName: "款号", field: "sku", minWidth: 126 },
      {
        headerName: "分类（三级）",
        field: "categoryPath",
        minWidth: 280,
        flex: 1,
        editable: true,
        cellRenderer: (params: ICellRendererParams<GridRow, string>) => (
          <span className="gridCategoryPath">{params.value}</span>
        ),
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: { values: categoryPaths },
      },
      {
        headerName: "颜色",
        field: "colorTag",
        minWidth: 130,
        editable: true,
        cellRenderer: (params: ICellRendererParams<GridRow, string>) => (
          <span className="gridColourValue">
            <ColourDot value={params.value || ""} />
            {params.value}
          </span>
        ),
        cellEditor: PickerEditor,
        cellEditorPopup: true,
        cellEditorParams: { values: colorChoices, showColour: true },
      },
      {
        headerName: "价格（CNY）",
        field: "price",
        minWidth: 130,
        filter: "agNumberColumnFilter",
        valueFormatter: (params) =>
          params.value === null || params.value === undefined
            ? "—"
            : `¥${Number(params.value).toLocaleString("zh-CN")}`,
      },
      {
        headerName: "备注",
        field: "note",
        minWidth: 220,
        flex: 1,
        tooltipField: "note",
      },
    ],
    [categoryPaths],
  );

  return (
    <main className="skuGridPage">
      <header className="skuGridHeader">
        <div>
          <span>PRODUCT LIST MANAGEMENT</span>
          <h1>产品清单管理</h1>
          <p>{status}</p>
        </div>
        <div className="skuGridActions">
          <button className="pairingManageButton" onClick={openPairingManager}>
            管理配对
          </button>
          <button
            className="outline"
            disabled={!undoStack.length}
            onClick={() => void undoLastChange()}
          >
            撤销上一步{undoStack.length ? ` (${undoStack.length})` : ""}
          </button>
          <button className="outline" onClick={() => window.close()}>
            关闭窗口
          </button>
        </div>
      </header>
      <section className="skuGridToolbar">
        <label>
          搜索 SKU、款号、分类、颜色或备注
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="输入关键词搜索全部 SKU"
          />
        </label>
        <small>点击列表标题可排序；标题下的筛选图标可进行列筛选。</small>
      </section>
      <section className="ag-theme-quartz skuGridTable">
        <AgGridReact<GridRow>
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          quickFilterText={search}
          rowSelection="multiple"
          suppressRowClickSelection
          animateRows
          pagination
          paginationPageSize={100}
          paginationPageSizeSelector={[50, 100, 250]}
          onCellValueChanged={saveChange}
          onSelectionChanged={(event: SelectionChangedEvent<GridRow>) =>
            setSelectedRows(event.api.getSelectedRows())
          }
          getRowId={(params) => params.data.id}
          rowHeight={64}
        />
      </section>
      {!!selectedRows.length && (
        <section className="skuBatchBar" aria-label="批量操作">
          <b>已选择 {selectedRows.length} 个 SKU</b>
          <label>
            产品大类
            <select
              value={batchCategory1}
              onChange={(event) => {
                setBatchCategory1(event.target.value);
                setBatchCategory2("");
                setBatchCategory3("");
              }}
            >
              <option value="">选择产品大类</option>
              {batchCategory1Options.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            区域分类
            <select
              disabled={!batchCategory1}
              value={batchCategory2}
              onChange={(event) => {
                setBatchCategory2(event.target.value);
                setBatchCategory3("");
              }}
            >
              <option value="">选择区域分类</option>
              {batchCategory2Options.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            三级分类
            <select
              disabled={!batchCategory2}
              value={batchCategory3}
              onChange={(event) => setBatchCategory3(event.target.value)}
            >
              <option value="">选择三级分类</option>
              {batchCategory3Options.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={!batchCategory1 || !batchCategory2 || !batchCategory3}
            onClick={() => void applyBatchCategory()}
          >
            应用分类
          </button>
        </section>
      )}
      {pairingOpen && (
        <div className="pairingOverlay">
          <section className="pairingManager" aria-label="管理产品配对">
            <header className="pairingHead">
              <div>
                <span>PRODUCT PAIRING</span>
                <h2>管理配对</h2>
              </div>
              <button onClick={() => setPairingOpen(false)} aria-label="关闭配对管理">
                ×
              </button>
            </header>
            <div className="pairingFilters">
              <label>
                模拟区分类
                <select
                  value={pairingCategory}
                  onChange={(event) => {
                    setPairingCategory(event.target.value);
                    setPairingSourceId("");
                    setPairingTargetIds(new Set());
                    setPairingQuantities({});
                    setPairingSavedMessage("");
                  }}
                >
                  {simulationCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label className="pairingSearch">
                查找产品或款号
                <input
                  value={pairingSearch}
                  onChange={(event) => setPairingSearch(event.target.value)}
                  placeholder="输入名称、英文或款号"
                  type="search"
                />
              </label>
              <p>先选择左侧模拟区产品，再在右侧选择配套玩具并填写数量。</p>
            </div>
            {pairingCategory === "厨房区" && (
              <section className="areaPairingRules" aria-label="厨房区统一配对规则">
                <div>
                  <h3>厨房区统一配对规则</h3>
                  <p>全部厨房模拟设备共用；仅录入表格中已明确的必配与选配规则。</p>
                </div>
                <div className="areaRuleList">
                  {kitchenAreaPairingRules.map((rule) => (
                    <article key={rule.id}>
                      <b>{rule.name}</b>
                      <span>
                        {rule.selectionMode === "fixed"
                          ? "固定必配"
                          : rule.selectionMode === "single"
                            ? `单选 ${rule.minSelections} 项`
                            : `多选 ${rule.minSelections}–${rule.maxSelections} 项`}
                      </span>
                      <small>{rule.note}</small>
                      <em>
                        {rule.items.map((item) => {
                          const product = rows.find((row) => row.sku === item.sku);
                          return `${item.sku}${product ? ` ${product.productName}` : ""} ×${item.quantity}`;
                        }).join(" · ")}
                      </em>
                    </article>
                  ))}
                </div>
                <button
                  className="primary"
                  disabled={areaRuleSaving}
                  onClick={() => void saveKitchenAreaRules()}
                >
                  {areaRuleSaving
                    ? "保存中…"
                    : savedKitchenRules
                      ? "更新厨房规则"
                      : "保存厨房规则"}
                </button>
                <button
                  className="outline"
                  disabled={!savedKitchenRules || areaRuleApplying}
                  onClick={() => void applyKitchenAreaRules()}
                >
                  {areaRuleApplying ? "配对保存中…" : "应用给全部厨房设备"}
                </button>
              </section>
            )}
            <div className="pairingColumns">
              <section>
                <header>
                  <b>模拟区产品</b>
                  <span>已选 {pairingSourceId ? 1 : 0} · {pairingSimulationRows.length} 项</span>
                </header>
                <div className="pairingThumbGrid pairingSimulationGrid">
                  {pairingSimulationRows.map((product) => {
                    const savedCount = pairingCountsBySourceId.get(product.id) || 0;
                    return (
                      <button
                        className={`pairingSimulationCard ${
                          product.id === pairingSourceId ? "selected" : ""
                        }`}
                        key={product.id}
                        onClick={() => selectPairingSource(product.id)}
                        title={`${product.productName} · ${product.sku}`}
                        aria-label={`选择 ${product.productName}`}
                      >
                        {product.image && <img src={product.image} alt="" />}
                        {savedCount > 0 && (
                          <span className="pairingSavedBadge">已配对 {savedCount}</span>
                        )}
                        <span className="pairingSku">{product.sku}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
              <section>
                <header>
                  <b>配套玩具</b>
                  <span>已选 {pairingTargetIds.size} SKU · 总数量 {selectedToyQuantity} · 共 {pairingToyRows.length} 项</span>
                </header>
                <div className="pairingThumbGrid pairingToyGrid">
                  {pairingToyRows.map((product) => (
                    <article
                      className={
                        `pairingToyCard ${pairingTargetIds.has(product.id) ? "selected" : ""}`
                      }
                      key={product.id}
                    >
                      <button
                        className="pairingToyThumb"
                        disabled={!pairingSourceId}
                        onClick={() => togglePairingTarget(product.id)}
                        title={`${product.productName} · ${product.sku}`}
                        aria-label={`关联 ${product.productName}`}
                      >
                        {product.image && <img src={product.image} alt="" />}
                        <span className="pairingSku">{product.sku}</span>
                      </button>
                      <div className="pairingQuantity" aria-label={`${product.sku} 的数量`}>
                        <button
                          aria-label={`减少 ${product.sku} 数量`}
                          disabled={!pairingSourceId || !pairingTargetIds.has(product.id)}
                          onClick={() => setPairingQuantity(product.id, (pairingQuantities[product.id] || 1) - 1)}
                          type="button"
                        >
                          −
                        </button>
                        <input
                          aria-label={`${product.sku} 数量`}
                          disabled={!pairingSourceId}
                          min="0"
                          onChange={(event) => setPairingQuantity(product.id, Number(event.target.value))}
                          type="number"
                          value={pairingQuantities[product.id] || 0}
                        />
                        <button
                          aria-label={`增加 ${product.sku} 数量`}
                          disabled={!pairingSourceId}
                          onClick={() => setPairingQuantity(product.id, (pairingQuantities[product.id] || 0) + 1)}
                          type="button"
                        >
                          +
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
            <footer className="pairingFoot">
              <span>
                {pairingSavedMessage ||
                  (pairingSourceId
                    ? `当前选择 ${pairingTargetIds.size} 个配套玩具，总数量 ${selectedToyQuantity}；保存后会保留在该模拟产品下。`
                    : "请选择左侧模拟区产品；带“已配对”标记的产品已有保存记录。")}
              </span>
              <button
                className="primary"
                disabled={!pairingSourceId || pairingSaving}
                onClick={() => void savePairing()}
              >
                {pairingSaving ? "保存中…" : "保存配对"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
