# Robinhood Trading MCP - live capability surface, observed 2026-08-08

Raw observation. Classification is a separate artifact; this file records what the server
actually returned, not what we decided about it.

## Session
    server            robinhood-trading v1.1.1
    protocol          2025-06-18
    client            shared public client via PKCE, no per-client identity
    scope             internal (single scope; scope=internal required on authorize)
    token lifetime    774,924 seconds - approximately nine days
    token persisted   no
    account reads     none performed
    mutations         none performed

The nine-day token lifetime was far longer than assumed. It reinforces rather than weakens
the decision not to persist: a leaked token is a nine-day brokerage credential.

## 54 tools returned by tools/list

    add_option_to_watchlist          add_to_watchlist
    cancel_equity_order              cancel_option_exercise
    cancel_option_order              create_scan
    create_watchlist                 exercise_option
    follow_watchlist                 get_accounts
    get_earnings_calendar            get_earnings_results
    get_equity_fundamentals          get_equity_historicals
    get_equity_orders                get_equity_positions
    get_equity_price_book            get_equity_quotes
    get_equity_tax_lots              get_equity_technical_indicators
    get_equity_tradability           get_financials
    get_index_historicals            get_index_quotes
    get_indexes                      get_limited_margin_upgrade_info
    get_option_chains                get_option_historicals
    get_option_instruments           get_option_level_upgrade_info
    get_option_orders                get_option_positions
    get_option_quotes                get_option_watchlist
    get_pnl_trade_history            get_popular_watchlists
    get_portfolio                    get_realized_pnl
    get_scanner_filter_specs         get_scans
    get_watchlist_items              get_watchlists
    place_equity_order               place_option_order
    remove_from_watchlist            remove_option_from_watchlist
    review_equity_order              review_option_order
    run_scan                         search
    unfollow_watchlist               update_scan_config
    update_scan_filters              update_watchlist

## First audit result
    allowed (observation)      2   get_portfolio, get_watchlists
    known mutating             7   add_to_watchlist, cancel_equity_order, cancel_option_order,
                                   create_watchlist, place_equity_order, place_option_order,
                                   update_watchlist
    pending classification     2   review_equity_order, review_option_order
    UNCLASSIFIED              43

## What the unclassified count proves
The allowlist was written from guessed names and mostly guessed wrong. get_positions does
not exist - it is get_equity_positions. get_pnl does not exist - it is get_realized_pnl and
get_pnl_trade_history. Nothing became callable as a result, because unlisted tools default
to DENY.

Two mutating capabilities were never anticipated and sat in the unclassified pile:
exercise_option and cancel_option_exercise. An allowlist built on imagination would have
missed both. Default-deny is what made the guessing survivable.

## Self-described semantics worth noting
    review_equity_order   "Simulate a stock order without placing it. Returns the current
                          quote p..." (truncated in the run)
    place_equity_order    "Place a real equity order with real money. Parameters mirror
                          review_eq..."
    exercise_option       "Exercise a long options position - a call exercises the right to
                          buy t..."

review_* describes itself as non-placing. That is evidence toward promotion but the full
schema has not been captured, so it stays denied.

## Surface is broader than the public documentation suggested
Scanners, saved screeners, option exercise, tax lots, technical indicators, earnings
calendars, index data and margin upgrade paths. A governance layer over this has
considerably more to classify than buy and sell.
