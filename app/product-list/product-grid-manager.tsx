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
  const [batchCategoryPath, setBatchCategoryPath] = useState("");

  const load = async () => {
    const response = await fetch("/api/catalog");
    if (!response.ok) {
      setStatus("无法加载产品清单，请返回主页面重新登录。");
      return;
    }
    const data = await response.json();
    setRows(gridRows(data.products || [], data.overrides || []));
    setCategories(data.categories || []);
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
    if (!batchCategoryPath || !selectedRows.length) return;
    const [category1, category2, category3 = "未细分"] = batchCategoryPath.split(" / ");
    const updates = selectedRows.map((row) => ({
      productId: row.id,
      patch: { category1, category2, category3 },
      restoreRow: row,
      updatedRow: {
        ...row,
        category1,
        category2,
        category3,
        categoryPath: batchCategoryPath,
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
    setBatchCategoryPath("");
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
            批量修改分类
            <select
              value={batchCategoryPath}
              onChange={(event) => setBatchCategoryPath(event.target.value)}
            >
              <option value="">选择新的三级分类</option>
              {categoryPaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={!batchCategoryPath}
            onClick={() => void applyBatchCategory()}
          >
            应用分类
          </button>
        </section>
      )}
    </main>
  );
}
