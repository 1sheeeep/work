import { useEffect, useState } from "react";
import { Search, UserRound, X } from "lucide-react";
import { PlatformAPI, TicketCustomer } from "../../api";
import { errorText } from "../shared/helpers";

export function TicketCustomerPicker(props: {
  api: PlatformAPI;
  shopId: string;
  value: TicketCustomer | null;
  onChange: (value: TicketCustomer | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TicketCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    setQuery("");
    setResults([]);
    setFailure("");
  }, [props.shopId]);

  useEffect(() => {
    const normalized = query.trim();
    if (!props.shopId || normalized.length < 2 || props.value) {
      setResults([]);
      setLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailure("");
      void props.api.searchTicketCustomers(props.shopId, normalized)
        .then((items) => {
          if (active) setResults(items);
        })
        .catch((error) => {
          if (active) setFailure(errorText(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [props.api, props.shopId, props.value, query]);

  if (props.value) {
    return <div className="ticket-customer-selected">
      <UserRound size={16} />
      <span>
        <strong>{props.value.customerName || props.value.customerEmail || "客户"}</strong>
        {props.value.customerEmail ? <small>{props.value.customerEmail}</small> : null}
      </span>
      <button type="button" aria-label="取消关联客户" onClick={() => props.onChange(null)}><X size={15} /></button>
    </div>;
  }

  return <div className="ticket-customer-picker">
    <label>
      <Search size={15} />
      <input
        value={query}
        disabled={!props.shopId}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={props.shopId ? "输入客户姓名或邮箱" : "请先选择店铺"}
      />
    </label>
    {query.trim().length > 0 && query.trim().length < 2 ? <small>至少输入 2 个字符</small> : null}
    {failure ? <small className="error">客户搜索失败：{failure}</small> : null}
    {loading ? <small>正在搜索客户...</small> : null}
    {!loading && query.trim().length >= 2 && !results.length && !failure ? <small>未找到匹配客户</small> : null}
    {results.length ? <div className="ticket-customer-results">
      {results.map((customer) => <button type="button" key={customer.customerRef} onClick={() => {
        props.onChange(customer);
        setQuery("");
        setResults([]);
      }}>
        <UserRound size={15} />
        <span>
          <strong>{customer.customerName || customer.customerEmail || "客户"}</strong>
          <small>{customer.customerEmail || "暂无邮箱"}</small>
        </span>
      </button>)}
    </div> : null}
  </div>;
}
