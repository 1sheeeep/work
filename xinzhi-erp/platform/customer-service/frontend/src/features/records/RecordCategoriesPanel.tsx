import { FormEvent, useEffect, useMemo, useState } from "react";
import { Layers3, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { PlatformAPI, RecordCategoryOption } from "../../api";
import { errorText } from "../shared/helpers";
import { ToastTone } from "../shared/types";

type CategoryLevel = "primary" | "secondary" | "tertiary";
type CategoryLists = Record<CategoryLevel, string[]>;

const emptyLists: CategoryLists = { primary: [], secondary: [], tertiary: [] };
const levelDetails: Array<{ key: CategoryLevel; title: string; placeholder: string }> = [
  { key: "primary", title: "一级分类", placeholder: "输入一级分类名称" },
  { key: "secondary", title: "二级分类", placeholder: "输入二级分类名称" },
  { key: "tertiary", title: "三级分类", placeholder: "输入三级分类名称" }
];

export function RecordCategoriesPanel(props: {
  api: PlatformAPI;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const [lists, setLists] = useState<CategoryLists>(emptyLists);
  const [savedLists, setSavedLists] = useState<CategoryLists>(emptyLists);
  const [newValues, setNewValues] = useState<Record<CategoryLevel, string>>({ primary: "", secondary: "", tertiary: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = useMemo(() => JSON.stringify(lists) !== JSON.stringify(savedLists), [lists, savedLists]);
  const complete = levelDetails.every((level) => lists[level.key].length > 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void props.api.listRecordCategories()
      .then((items) => {
        if (!cancelled) {
          const loaded = listsFromCategories(items);
          setLists(loaded);
          setSavedLists(loaded);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(`加载处理分类失败：${errorText(reason)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [props.api]);

  function addValue(event: FormEvent, level: CategoryLevel) {
    event.preventDefault();
    const details = levelDetails.find((item) => item.key === level)!;
    const value = newValues[level].trim();
    if (!value) {
      props.setToast({ tone: "info", text: `请输入${details.title}名称` });
      return;
    }
    if (lists[level].includes(value)) {
      props.setToast({ tone: "info", text: `${details.title}“${value}”已存在` });
      return;
    }
    setLists((current) => ({ ...current, [level]: [...current[level], value] }));
    setNewValues((current) => ({ ...current, [level]: "" }));
    props.setToast({ tone: "success", text: `${details.title}已加入列表，请保存后生效` });
  }

  function removeValue(level: CategoryLevel, value: string) {
    const details = levelDetails.find((item) => item.key === level)!;
    if (lists[level].length <= 1) {
      props.setToast({ tone: "info", text: `${details.title}至少保留一项` });
      return;
    }
    if (!window.confirm(`确定删除${details.title}“${value}”吗？历史工单中的原分类文字仍会保留。`)) return;
    setLists((current) => ({ ...current, [level]: current[level].filter((item) => item !== value) }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const saved = await props.api.saveRecordCategories(categoriesFromLists(lists));
      const normalized = listsFromCategories(saved);
      setLists(normalized);
      setSavedLists(normalized);
      props.setToast({ tone: "success", text: "处理分类已保存，三个层级可自由组合" });
    } catch (reason) {
      const message = `保存处理分类失败：${errorText(reason)}`;
      setError(message);
      props.setToast({ tone: "error", text: message });
    } finally {
      setSaving(false);
    }
  }

  function resetChanges() {
    setLists(cloneLists(savedLists));
    setNewValues({ primary: "", secondary: "", tertiary: "" });
    setError("");
    props.setToast({ tone: "info", text: "未保存的分类修改已撤销" });
  }

  return (
    <section className="records-admin-page category-admin-page">
      <header className="records-page-header">
        <div><h2>处理分类</h2><p>一级、二级、三级分类相互独立，可分别维护并自由组合使用。</p></div>
        <div className="category-header-actions">
          <span className={dirty ? "dirty" : ""}>{dirty ? "有未保存修改" : "已保存"}</span>
          <button type="button" onClick={resetChanges} disabled={loading || saving || !dirty}><RotateCcw size={15} />撤销修改</button>
          <button className="primary" type="button" onClick={() => void save()} disabled={loading || saving || !dirty || !complete}><Save size={15} />{saving ? "保存中" : "保存分类"}</button>
        </div>
      </header>
      {error ? <div className="records-page-error" role="alert">{error}</div> : null}
      {loading ? <div className="records-empty">正在加载处理分类</div> : (
        <div className="category-workspace independent">
          {levelDetails.map((level) => (
            <section className="category-level-column" key={level.key} aria-labelledby={`category-${level.key}-title`}>
              <header className="category-level-header">
                <div><Layers3 size={17} /><strong id={`category-${level.key}-title`}>{level.title}</strong></div>
                <span>{lists[level.key].length} 项</span>
              </header>
              <form className="category-level-add" onSubmit={(event) => addValue(event, level.key)}>
                <input
                  value={newValues[level.key]}
                  onChange={(event) => setNewValues((current) => ({ ...current, [level.key]: event.target.value }))}
                  placeholder={level.placeholder}
                  aria-label={`新增${level.title}`}
                  disabled={saving}
                />
                <button className="primary" type="submit" disabled={saving}><Plus size={15} />添加</button>
              </form>
              <div className="category-level-list">
                {lists[level.key].map((value, index) => (
                  <div className="category-level-row" key={value}>
                    <span className="category-level-index">{index + 1}</span>
                    <span title={value}>{value}</span>
                    <button
                      type="button"
                      title={lists[level.key].length === 1 ? `${level.title}至少保留一项` : `删除${level.title}`}
                      aria-label={`删除${level.title} ${value}`}
                      disabled={saving || lists[level.key].length === 1}
                      onClick={() => removeValue(level.key, value)}
                    ><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function listsFromCategories(categories: RecordCategoryOption[]): CategoryLists {
  const primary: string[] = [];
  const secondary: string[] = [];
  const tertiary: string[] = [];
  const addUnique = (target: string[], value: string) => {
    const normalized = value.trim();
    if (normalized && !target.includes(normalized)) target.push(normalized);
  };
  categories.forEach((category) => {
    addUnique(primary, category.primary);
    addUnique(secondary, category.secondary);
    category.tertiary.forEach((value) => addUnique(tertiary, value));
  });
  return { primary, secondary, tertiary };
}

function categoriesFromLists(lists: CategoryLists): RecordCategoryOption[] {
  return lists.primary.flatMap((primary) => lists.secondary.map((secondary) => ({
    primary,
    secondary,
    tertiary: [...lists.tertiary]
  })));
}

function cloneLists(lists: CategoryLists): CategoryLists {
  return { primary: [...lists.primary], secondary: [...lists.secondary], tertiary: [...lists.tertiary] };
}
