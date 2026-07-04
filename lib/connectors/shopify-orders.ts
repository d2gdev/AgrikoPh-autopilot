import { shopifyFetch } from "@/lib/shopify-admin";

export interface OrderRow {
  id: string;
  createdAt: string;
  cancelled: boolean;
  financialStatus: string | null;
  total: number;
  productIds: string[];
}

interface OrdersResponse {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        createdAt: string;
        cancelledAt: string | null;
        displayFinancialStatus: string | null;
        currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
        lineItems: { edges: Array<{ node: { product: { id: string } | null } }> };
      };
    }>;
  };
}

const QUERY = `
  query OrdersWindow($after: String, $query: String!) {
    orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          createdAt
          cancelledAt
          displayFinancialStatus
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 50) {
            edges {
              node {
                product {
                  id
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function fetchOrdersWindow(range: {
  start: Date;
  end: Date;
}): Promise<{ orders: OrderRow[]; currency: string | null }> {
  const search = `created_at:>='${range.start.toISOString()}' created_at:<'${range.end.toISOString()}'`;
  const orders: OrderRow[] = [];
  let currency: string | null = null;
  let after: string | null = null;
  let page = 0;
  const MAX_PAGES = 30; // 3,000 orders/window guard — far above daily volume

  do {
    const data: OrdersResponse = await shopifyFetch<OrdersResponse>(QUERY, { after, query: search });
    for (const { node } of data.orders.edges) {
      const money = node.currentTotalPriceSet?.shopMoney;
      if (money && !currency) currency = money.currencyCode;
      orders.push({
        id: node.id,
        createdAt: node.createdAt,
        cancelled: Boolean(node.cancelledAt),
        financialStatus: node.displayFinancialStatus,
        total: money ? parseFloat(money.amount) || 0 : 0,
        productIds: node.lineItems.edges
          .map((e) => e.node.product?.id)
          .filter((id): id is string => Boolean(id)),
      });
    }
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    if (++page >= MAX_PAGES && after) {
      console.warn(`[shopify-orders] fetchOrdersWindow truncated at ${MAX_PAGES} pages`);
      break;
    }
  } while (after);

  return { orders, currency };
}
