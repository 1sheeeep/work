import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "../auth/AuthContext";
import { orderCenterApi, type OrderDetail } from "../modules/orderCenterApi";
import {
  isOrderId,
  orderDetailReturnFocusId,
  orderListPath,
  OrderDialog,
  parseOrderQuery,
  requestOrderListFocus,
  safeOrderError,
} from "./OrderCenterPage";

type DetailState = "loading" | "ready" | "error";

export function OrderDetailPage({ orderId }: { orderId: string }) {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const query = useMemo(() => parseOrderQuery(search), [search]);
  const returnFocusId = useMemo(
    () => orderDetailReturnFocusId(search),
    [search],
  );
  const request = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<DetailState>("loading");
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [message, setMessage] = useState("");
  const canRead = hasPermission("orders.read");
  const canWrite = hasPermission("orders.write");
  const canShopifyEdit = hasPermission("orders.shopify_edit.write");
  const canReadProducts = hasPermission("products.read");
  const canReadListings = hasPermission("products.listing.read");
  const fulfillmentPermissions = {
    read: hasPermission("fulfillments.read"),
    allocate: hasPermission("fulfillments.allocate.write"),
    pick: hasPermission("fulfillments.pick.write"),
    pack: hasPermission("fulfillments.pack.write"),
    ship: hasPermission("fulfillments.ship.write"),
    weighOverride: hasPermission("fulfillments.weigh.override"),
    correct: hasPermission("fulfillments.ship.correct.write"),
    exceptions: hasPermission("fulfillments.exception.write"),
    cancel: hasPermission("fulfillments.cancel.write"),
  };
  const validOrderId = isOrderId(orderId);

  useEffect(() => {
    const current = ++request.current;
    setDetail(null);
    setMessage("");

    if (!canRead) {
      setState("error");
      setMessage("暂无访问权限，无法查看订单详情。");
      return;
    }
    if (!validOrderId) {
      setState("error");
      setMessage("订单地址格式无效。");
      return;
    }

    setState("loading");
    void orderCenterApi
      .get(orderId)
      .then((result) => {
        if (current !== request.current) return;
        setDetail(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (current !== request.current) return;
        setMessage(safeOrderError(error));
        setState("error");
      });

    return () => {
      if (current === request.current) request.current += 1;
    };
  }, [canRead, orderId, refreshKey, validOrderId]);

  const returnToList = useCallback(() => {
    requestOrderListFocus(returnFocusId);
    router.history.push(orderListPath(query));
  }, [query, returnFocusId, router.history]);

  if (state === "loading") {
    return (
      <section className="order-center-page">
        <p className="order-list-state" aria-busy="true">
          正在加载订单详情…
        </p>
      </section>
    );
  }

  if (state === "error" || !detail) {
    return (
      <section
        className="order-center-page"
        aria-labelledby="order-detail-error-title"
      >
        <div className="compact-empty-state" role="alert">
          <strong id="order-detail-error-title">无法显示订单详情</strong>
          <span>{message}</span>
          {validOrderId && canRead && (
            <button
              className="text-button"
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              重试加载详情
            </button>
          )}
          <button className="text-button" type="button" onClick={returnToList}>
            返回订单列表
          </button>
        </div>
      </section>
    );
  }

  return (
    <OrderDialog
      detail={detail}
      canWrite={canWrite}
      canShopifyEdit={canShopifyEdit}
      canReadProducts={canReadProducts}
      canReadListings={canReadListings}
      fulfillmentPermissions={fulfillmentPermissions}
      onChanged={setDetail}
      onClose={returnToList}
    />
  );
}
