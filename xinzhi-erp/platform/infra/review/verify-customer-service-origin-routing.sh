#!/bin/sh
set -eu

env_file=${1:-/opt/xinzhi-erp/shopify/shopify.env}

if [ ! -f "$env_file" ]; then
  echo "FAIL: Shopify Connector environment file was not found." >&2
  exit 1
fi

awk '
  function trim(value) {
    sub(/^[[:space:]]+/, "", value)
    sub(/[[:space:]\r]+$/, "", value)
    return value
  }

  function unquote(value, first, last) {
    value = trim(value)
    first = substr(value, 1, 1)
    last = substr(value, length(value), 1)
    if (length(value) >= 2 && ((first == "\"" && last == "\"") || (first == "\047" && last == "\047"))) {
      return substr(value, 2, length(value) - 2)
    }
    return value
  }

  function fail(message) {
    print "FAIL: " message > "/dev/stderr"
    exit 1
  }

  BEGIN {
    production_origin = "https://kf.xzkj.ai"
    review_shop = "xinzhi-app-lab.myshopify.com"
    review_origin = "https://kf-uat.xzkj.ai"
  }

  index($0, "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN=") == 1 {
    default_count++
    default_value = substr($0, index($0, "=") + 1)
    next
  }

  index($0, "SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES=") == 1 {
    overrides_count++
    overrides_value = substr($0, index($0, "=") + 1)
    next
  }

  END {
    if (default_count > 1 || overrides_count > 1) {
      fail("customer-service routing keys must not be duplicated.")
    }

    resolved_default = unquote(default_value)
    if (default_count == 0 || resolved_default == "") {
      resolved_default = production_origin
    }
    if (resolved_default != production_origin) {
      fail("the shared Connector default must remain on the production customer-service origin.")
    }

    if (overrides_count != 1) {
      fail("the review-store customer-service override is missing.")
    }
    raw_overrides = unquote(overrides_value)
    entry_count = split(raw_overrides, entries, ",")
    if (entry_count != 1) {
      fail("only the prepared review shop may have a customer-service origin override.")
    }

    separator = index(entries[1], "=")
    if (separator < 2) {
      fail("the review-store customer-service override is malformed.")
    }
    configured_shop = tolower(trim(substr(entries[1], 1, separator - 1)))
    configured_origin = trim(substr(entries[1], separator + 1))
    if (configured_shop != review_shop || configured_origin != review_origin) {
      fail("the customer-service override does not match the prepared review shop and isolated UAT origin.")
    }

    print "PASS: production customer service is preserved and review-store UAT routing is isolated."
  }
' "$env_file"
