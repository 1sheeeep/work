package cn.xzkj.erp.analytics.listingsales;

import java.util.List;

public record ListingRealtimeSalesResult(
        List<ListingRealtimeSalesItem> items,
        long totalListingCount,
        long totalRangeSalesQuantity) {
    public ListingRealtimeSalesResult {
        items = List.copyOf(items);
    }

    public static ListingRealtimeSalesResult empty() {
        return new ListingRealtimeSalesResult(List.of(), 0, 0);
    }
}
