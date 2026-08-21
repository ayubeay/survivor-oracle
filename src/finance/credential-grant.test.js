const { declareCredentialGrant, permitsClass, residualClientBounds, revokeCredential,
        derivePermittedClasses, unmappedPermissions, OPERATION_CLASS,
        RISK_BEARING_CLASS } = require('./credential-grant');
const { CLASS, checkToolCall, guardedCall, auditToolList } = require('./capability-firewall');
const { issueAuthorization, reset } = require('./execution-authorization');
const { issueMandate, checkAgainstMandate } = require('./mandate');
const { ROBINHOOD_AGENTIC, CRYPTO_COM_EXCHANGE } = require('./connector-capabilities');

let pass = 0, fail = 0;
const t = (n, c) => c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n));
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

const CC = CRYPTO_COM_EXCHANGE.credential_grant_model;
const MANDATORY = CC.mandatory;

console.log('\nthe class vocabulary has not drifted from the firewall');
// A silent divergence here would make every class check vacuous - the grant would permit
// 'MUTATE_ORDER' while the firewall asked about something spelled differently.
t('every operation class exists in the firewall', OPERATION_CLASS.every(c => CLASS[c] === c));
t('every firewall class is known here', Object.keys(CLASS).every(c => OPERATION_CLASS.indexOf(c) !== -1));
t('risk-bearing classes are real classes', RISK_BEARING_CLASS.every(c => OPERATION_CLASS.indexOf(c) !== -1));
t('MUTATE_ORDER is risk-bearing', RISK_BEARING_CLASS.indexOf('MUTATE_ORDER') !== -1);
t('observation is not', RISK_BEARING_CLASS.indexOf('OBSERVE_MARKET') === -1);

console.log('\na credential narrows a connector, and may not extend it');
t('inventing a permission is refused', throws(() => declareCredentialGrant({
  credential_alias: 'k', connector: CRYPTO_COM_EXCHANGE,
  granted: MANDATORY.concat(['Withdraw to any address']),
}), /cannot extend it/));
t('omitting a mandatory permission is refused', throws(() => declareCredentialGrant({
  credential_alias: 'k', connector: CRYPTO_COM_EXCHANGE, granted: ['Execute trades'],
}), /does not allow to be removed/));
t('a connector with no grant model is refused', throws(() => declareCredentialGrant({
  credential_alias: 'k', connector: { connector: 'nameless', capabilities: {} },
}), /declares no credential_grant_model/));
t('an unrecognised surface is refused rather than guessed', throws(() => declareCredentialGrant({
  credential_alias: 'k', connector: { connector: 'x', credential_grant_model: { surface: 'SOMETHING_NEW' } },
}), /refusing rather than guessing/));

console.log('\nthe minimum grant crypto.com actually permits');
const MIN = declareCredentialGrant({
  credential_alias: 'cdc_min', connector: CRYPTO_COM_EXCHANGE, granted: MANDATORY,
});
t('accepted', MIN.grant_state === 'OBSERVED_CONFIGURED');
t('carries only the irreducible permission', MIN.granted.join() === 'View balance & transactions');
t('cash withdrawals are excluded', MIN.excluded.indexOf('Make cash withdrawals') !== -1);
t('execute trades is excluded', MIN.excluded.indexOf('Execute trades') !== -1);
t('so it does not permit execution', MIN.permits_execution === false);
t('but does permit account observation', MIN.permitted_classes.indexOf('OBSERVE_ACCOUNT') !== -1);

console.log('\nthe narrowest key that could ever trade');
const TRADE = declareCredentialGrant({
  credential_alias: 'cdc_trade', connector: CRYPTO_COM_EXCHANGE,
  granted: MANDATORY.concat(['Execute trades']),
});
t('permits execution', TRADE.permits_execution === true);
t('still excludes cash withdrawals', TRADE.excluded.indexOf('Make cash withdrawals') !== -1);
t('withdrawal authority is therefore excludable, not inherent',
  TRADE.granted.indexOf('Make cash withdrawals') === -1 && TRADE.bounded_by_venue === true);

console.log('\nauthority no class covers cannot be granted silently');
// The hole this closes: a grant carrying all nine reported the SAME three permitted classes
// as a grant carrying two, because six of the nine map to no class. Make cash withdrawals
// lived in granted[] and appeared nowhere else in the object.
t('the minimum grant carries nothing unaccounted', MIN.unmapped_granted.length === 0);
t('and says so', MIN.carries_unaccounted_authority === false);
t('the trade grant likewise', TRADE.unmapped_granted.length === 0 &&
  TRADE.carries_unaccounted_authority === false);
t('the default grant cannot be declared silently', throws(() => declareCredentialGrant({
  credential_alias: 'cdc_default', connector: CRYPTO_COM_EXCHANGE,
  granted: CC.default_grant,
}), /no operation class requires/));
t('and the refusal names what would go unchecked', throws(() => declareCredentialGrant({
  credential_alias: 'cdc_default', connector: CRYPTO_COM_EXCHANGE,
  granted: CC.default_grant,
}), /Make cash withdrawals/));
const ACK = declareCredentialGrant({
  credential_alias: 'cdc_default_acknowledged', connector: CRYPTO_COM_EXCHANGE,
  granted: CC.default_grant, acknowledge_unaccounted_authority: true,
});
t('acknowledged, it declares', ACK.grant_state === 'OBSERVED_CONFIGURED');
t('and carries the six unaccounted permissions on its face', ACK.unmapped_granted.length === 6);
t('including cash withdrawals', ACK.unmapped_granted.indexOf('Make cash withdrawals') !== -1);
t('flagged rather than buried in granted[]', ACK.carries_unaccounted_authority === true);
// The point of the flag: these two agree on every class, and differ on what they can do.
t('it permits the same classes as the narrow key',
  ACK.permitted_classes.sort().join() === TRADE.permitted_classes.concat(['OBSERVE_MARKET']).sort().join());
t('so the class list alone could never have told them apart',
  ACK.carries_unaccounted_authority !== TRADE.carries_unaccounted_authority);
t('unmappedPermissions is exact',
  unmappedPermissions({ MUTATE_ORDER: ['a'] }, ['a', 'b']).join() === 'b');

console.log('\nclasses the connector says nothing about are denied, not assumed');
// Default closed by construction: a class appears only where the connector declares what it
// requires AND the grant satisfies it. Silence is not a grant.
t('SIMULATE is not certified by any crypto.com grant', TRADE.permitted_classes.indexOf('SIMULATE') === -1);
t('nor EXERCISE_DERIVATIVE', TRADE.permitted_classes.indexOf('EXERCISE_DERIVATIVE') === -1);
t('an empty requirement certifies nothing',
  derivePermittedClasses({ MUTATE_ORDER: [] }, ['Execute trades']).length === 0);

console.log('\nabsence of credential information is not unrestricted authority');
t('no grant denies a risk-bearing class', permitsClass(null, 'MUTATE_ORDER').code === 'NO_CREDENTIAL_GRANT');
t('no grant does not obstruct observation', permitsClass(null, 'OBSERVE_MARKET').permitted === true);
t('an unknown grant model is refused', permitsClass({ model_version: 'other' }, 'MUTATE_ORDER')
  .code === 'UNKNOWN_GRANT_MODEL');

console.log('\na credential that does not exist authorises nothing');
// Crypto.com's real state: the permission surface has been read, no key generated, Generate
// never pressed. Wiring the venue up by mistake still refuses.
t('grants default to NOT_YET_ISSUED', TRADE.credential_status === 'NOT_YET_ISSUED');
t('and therefore refuse execution', permitsClass(TRADE, 'MUTATE_ORDER').code === 'CREDENTIAL_NOT_ISSUED');
t('even though the grant itself permits it', TRADE.permits_execution === true);

// A hypothetical ISSUED credential, so class exclusion can be tested SEPARATELY from
// status. No Crypto.com key exists; this is a fixture, not a credential.
const MIN_ISSUED = declareCredentialGrant({
  credential_alias: 'cdc_min_hypothetical', connector: CRYPTO_COM_EXCHANGE,
  granted: MANDATORY, credential_status: 'ISSUED',
});
t('an issued minimum credential still refuses execution on CLASS, not status',
  permitsClass(MIN_ISSUED, 'MUTATE_ORDER').code === 'CAPABILITY_NOT_IN_CREDENTIAL_GRANT');
t('while permitting what it does carry',
  permitsClass(MIN_ISSUED, 'OBSERVE_ACCOUNT').permitted === true);

console.log('\nrobinhood: unbounded, observed rather than assumed');
t('an unacknowledged unbounded credential is refused', throws(() => declareCredentialGrant({
  credential_alias: 'rh', connector: ROBINHOOD_AGENTIC,
}), /acknowledge_unbounded/));
t('naming permissions it does not expose is fiction', throws(() => declareCredentialGrant({
  credential_alias: 'rh', connector: ROBINHOOD_AGENTIC, acknowledge_unbounded: true,
  granted: ['Execute trades'],
}), /would be fiction/));
const RH = declareCredentialGrant({
  credential_alias: 'robinhood_agentic_oauth', connector: ROBINHOOD_AGENTIC,
  acknowledge_unbounded: true, credential_status: 'ISSUED',
});
t('acknowledged unbounded is usable', RH.grant_state === 'UNBOUNDED_NOT_EXPOSED');
t('and says so on the receipt', RH.bounded_by_venue === false);
t('client enforcement is the only bound', RH.client_enforcement === 'THE_ONLY_BOUND');
t('venue enforcement names the absence', RH.venue_enforcement === 'NONE_EXPOSED');

console.log('\nno grant ever carries key material');
t('robinhood grant has no secret-shaped field',
  Object.keys(RH).every(k => !/secret|token|key$|password|private/i.test(k)));
t('crypto.com grant has no secret-shaped field',
  Object.keys(TRADE).every(k => !/secret|token|key$|password|private/i.test(k)));

console.log('\nrevocation keeps the hash and kills the authority');
const RH_DEAD = revokeCredential(RH);
t('authority hash is unchanged', RH_DEAD.grant_hash === RH.grant_hash);
t('but the credential no longer authorises', permitsClass(RH_DEAD, 'MUTATE_ORDER').code === 'CREDENTIAL_NOT_ISSUED');

console.log('\na mandate may not reach past the credential');
const MANDATE = () => issueMandate({
  issuer_identity: 'operator:test', subject_agent: 'test_agent',
  capabilities: ['place_equity_order'], venues: ['robinhood_agentic'],
  capital: { total_budget_usd: 100000, max_order_usd: 100000 },
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  execution: { autonomous_within_mandate: true },
});
const ORDER = { account_alias: 'agentic_account', symbol: 'NVDA', side: 'buy',
                notional_usd: 1000, order_type: 'market' };
const ALLOW_RECEIPT = { decision: 'ALLOW', model_version: 'p', state_snapshot_id: 'snap1' };
const m = MANDATE();
const mc = checkAgainstMandate({ mandate: m, order: ORDER, capability: 'place_equity_order',
                                 venue: 'robinhood_agentic', deployed_usd: 0,
                                 credentialGrant: MIN_ISSUED });
t('a fully mandated action is still refused outside the credential',
  mc.within_mandate === false && mc.code === 'CAPABILITY_NOT_IN_CREDENTIAL_GRANT');
t('and the detail names the class, not a lifecycle excuse',
  /CAPABILITY_NOT_IN_CREDENTIAL_GRANT/.test(mc.detail));
t('the same action passes with a credential that carries it',
  checkAgainstMandate({ mandate: m, order: ORDER, capability: 'place_equity_order',
                        venue: 'robinhood_agentic', deployed_usd: 0,
                        credentialGrant: RH }).within_mandate === true);
t('no authorization can be issued without a credential', throws(() => issueAuthorization({
  policyReceipt: ALLOW_RECEIPT, order: ORDER, capability: 'place_equity_order', mandate: m,
}), /Outside the credential grant: NO_CREDENTIAL_GRANT/));
t('nor with an issued credential that excludes execution', throws(() => issueAuthorization({
  policyReceipt: ALLOW_RECEIPT, order: ORDER, capability: 'place_equity_order', mandate: m,
  credentialGrant: MIN_ISSUED,
}), /CAPABILITY_NOT_IN_CREDENTIAL_GRANT/));
t('nor with a credential that has never been issued', throws(() => issueAuthorization({
  policyReceipt: ALLOW_RECEIPT, order: ORDER, capability: 'place_equity_order', mandate: m,
  credentialGrant: MIN,
}), /CREDENTIAL_NOT_ISSUED/));

console.log('\nthe credential constraint survives to the transport');
(async () => {
  const SNAP = 'snap1';
  const RECEIPT = { decision: 'ALLOW', model_version: 'p', state_snapshot_id: SNAP };
  const hits = [];
  const tport = async (n) => { hits.push(n); return { ok: true }; };

  reset();
  const m1 = MANDATE();
  const auth = issueAuthorization({ policyReceipt: RECEIPT, order: ORDER,
                                    capability: 'place_equity_order', mandate: m1,
                                    credentialGrant: RH });
  t('the authorization is bound to the credential', auth.credential_grant_hash === RH.grant_hash);
  t('and names it without naming key material', auth.credential_alias === 'robinhood_agentic_oauth');

  // The failure the real path has to catch. A component check that only runs at issuance
  // leaves the transport reachable by anyone who kept the authorization.
  try { await guardedCall(tport, 'place_equity_order', ORDER, auth, SNAP, m1, null);
        t('a missing credential should block the path', false); }
  catch (e) { t('a missing credential blocks at the firewall',
                e.receipt && e.receipt.reason === 'CREDENTIAL_GRANT_REFUSED' &&
                e.receipt.credential_failure === 'NO_CREDENTIAL_GRANT'); }
  t('transport not invoked', hits.length === 0);

  const WIDER = declareCredentialGrant({
    credential_alias: 'another_credential', connector: ROBINHOOD_AGENTIC,
    acknowledge_unbounded: true, credential_status: 'ISSUED',
  });
  try { await guardedCall(tport, 'place_equity_order', ORDER, auth, SNAP, m1, WIDER);
        t('a swapped credential should block', false); }
  catch (e) { t('a credential swapped after issuance blocks',
                e.receipt && e.receipt.authorization_failure === 'CREDENTIAL_GRANT_CHANGED_SINCE_AUTHORIZATION'); }
  t('transport still not invoked', hits.length === 0);

  // Same hash, dead credential - the kill-switch case that the mandate's revocation block
  // is modelled on. It must fail on status, not look like a swap.
  try { await guardedCall(tport, 'place_equity_order', ORDER, auth, SNAP, m1, revokeCredential(RH));
        t('a revoked credential should block', false); }
  catch (e) { t('a credential revoked mid-flight blocks immediately',
                e.receipt && e.receipt.credential_failure === 'CREDENTIAL_NOT_ISSUED'); }
  t('transport still not invoked after revocation', hits.length === 0);

  await guardedCall(tport, 'place_equity_order', ORDER, auth, SNAP, m1, RH);
  t('the correct credential does reach transport', hits.length === 1);

  console.log('\nunaccounted authority reaches the receipt');
  reset();
  const mU = MANDATE();
  const aU = issueAuthorization({ policyReceipt: RECEIPT, order: ORDER,
                                  capability: 'place_equity_order', mandate: mU,
                                  credentialGrant: RH });
  const recU = checkToolCall('place_equity_order', ORDER, aU, SNAP, mU, RH);
  t('an allow receipt records unaccounted authority',
    recU.credential_carries_unaccounted_authority === true);
  t('robinhood carries it because nothing can be narrowed',
    RH.carries_unaccounted_authority === true && RH.unmapped_granted === null);

  console.log('\nreceipts and audits name the credential');
  reset();
  const m2 = MANDATE();
  const a2 = issueAuthorization({ policyReceipt: RECEIPT, order: ORDER,
                                  capability: 'place_equity_order', mandate: m2,
                                  credentialGrant: RH });
  const rec = checkToolCall('place_equity_order', ORDER, a2, SNAP, m2, RH);
  t('an allow receipt names the credential', rec.credential_alias === 'robinhood_agentic_oauth');
  t('and its venue enforcement state', rec.credential_venue_enforcement === 'NONE_EXPOSED');
  const audit = auditToolList(['get_accounts', 'place_equity_order'], {}, RH);
  t('an audit without a credential says UNKNOWN, not unrestricted',
    auditToolList(['get_accounts'], {}).credential_grant_state === 'UNKNOWN');
  t('and with one records whether the venue bounds it', audit.credential_bounded_by_venue === false);

  console.log('\nobserved configuration is still not verified enforcement');
  t('a configured grant is enforced here', TRADE.client_enforcement === 'ENFORCED_HERE');
  t('and unverified at the venue', TRADE.venue_enforcement === 'UNVERIFIED');
  t('the class mapping is labelled an inference', TRADE.class_requirements_state === 'INFERRED_FROM_PERMISSION_LABELS');

  console.log('\nwhat the credential does NOT bound');
  const res = residualClientBounds(TRADE, CRYPTO_COM_EXCHANGE);
  // Two claims, kept apart on purpose. The UI absence was SEEN; the meaning of the
  // permission was not. Collapsing them turns an observation into an assumption.
  t('the UI exposes no product controls', res.product_scope_controls === 'NOT_EXPOSED_IN_AGENT_KEY_UI');
  t('and what Execute trades authorises stays unknown', res.product_scope_state === 'UNKNOWN');
  t('an absence of controls is never a claim about scope',
    res.product_scope_state !== 'ALL' && res.product_scope_state !== 'SPOT');
  t('so the credential does not bound product', res.credential_bounds_product === false);
  t('and the mandate carries instrument type alone',
    res.carried_by_mandate_alone.indexOf('instruments.allowed_types') !== -1);
  t('and leverage alone', res.carried_by_mandate_alone.indexOf('instruments.max_leverage') !== -1);
  t('the account product list is fenced off as evidence', res.account_surface_is_not_evidence === true);

  console.log('\naccount capability is not agent-key capability');
  // The account exposes crypto trading, Stocks, prediction products, Cash, Card, Earn,
  // Rewards and IRAs. None of that says an Agent Key can reach any of them. This block
  // exists so a later edit cannot quietly promote a product list into a capability list.
  const AS = CC.account_surface;
  t('the account surface is recorded', AS.product_families.length === 9);
  t('by menu section as displayed', Object.keys(AS.menu_sections).length === 9);
  t('including the More section agent key lives in',
    AS.menu_sections.More.indexOf('Agent Key') === 0);
  t('including the trade entries that were first summarised away',
    AS.menu_sections.Trade.indexOf('Price alerts') !== -1 &&
    AS.menu_sections.Trade.length === 5);
  t('marked as establishing account surface only', AS.establishes === 'ACCOUNT_SURFACE_ONLY');
  t('inference from it is forbidden', AS.inference_permitted === false);
  // Provenance is part of the claim, and it moves in both directions. This one was
  // downgraded on 2026-08-19 for lack of evidence and re-established on 2026-08-20 by
  // evidence. Both steps stay recorded - a claim that survived a downgrade is not the same
  // as one that was never checked.
  t('agent key is recorded as beta', AS.agent_key_maturity === 'BETA');
  t('now visually confirmed', AS.agent_key_provenance === 'VISUALLY_CONFIRMED');
  t('and the downgrade that preceded it is still on the record',
    AS.agent_key_provenance_history.length === 2 &&
    /NOT_VISUALLY_CONFIRMED/.test(AS.agent_key_provenance_history[0]));
  t('placement names the section it was found in', /under More/.test(AS.agent_key_placement));
  t('no product family leaks into the permission list',
    AS.product_families.every(f => CC.permissions.indexOf(f) === -1));
  t('nor into what any class requires',
    Object.keys(CC.class_requirements).every(k =>
      CC.class_requirements[k].every(p => CC.permissions.indexOf(p) !== -1)));
  t('a grant can never name a product family', throws(() => declareCredentialGrant({
    credential_alias: 'k', connector: CRYPTO_COM_EXCHANGE,
    granted: MANDATORY.concat(['Stocks']),
  }), /cannot extend it/));
  t('no raw screenshot is referenced',
    /no image, no personal identifier and no account balance is committed/.test(AS.note));

  console.log('\nno personal identifier reaches the repository');
  // The evidence is photographs of a live personal account showing a name and an email
  // address. Descriptions get committed; identifiers do not.
  const DECL = JSON.stringify(CRYPTO_COM_EXCHANGE);
  t('no email address in the connector declaration', !/[\w.]+@[\w.]+\.\w+/.test(DECL));
  t('no account holder name', !/ayuba|yusuf/i.test(DECL));
  // The later images also show reward balances. Venue configuration figures belong here;
  // the account holder's money does not.
  t('no account balance figure', !/74\.64/.test(DECL));

  console.log('\nthe set up step, seen directly');
  const KS = CRYPTO_COM_EXCHANGE.agent_key_setup;
  t('three steps: set up, verify, connect', KS.flow.join() === 'set_up,verify,connect');
  t('the screen calls the artifact an API key', KS.artifact_named === 'API key');
  t('expiration is a single-select radio', KS.expiration_control === 'SINGLE_SELECT_RADIO');
  t('permissions are a checkbox list in a sheet',
    KS.permissions_control === 'CHECKBOX_LIST_IN_BOTTOM_SHEET');
  t('the nine labels were confirmed by looking', KS.permissions_list_visually_confirmed === true);
  // The default state renders all nine identically, so no image can show which one will
  // refuse to uncheck. That fact came from interaction and only from interaction.
  t('but which one is mandatory is not visible',
    KS.permissions_mandatory_visually_distinguishable === false);
  t('the generate button is present and enabled', KS.generate_button === 'PRESENT_AND_ENABLED');
  // The screen says nothing about what Generate does. That silence is recorded as silence.
  t('the screen states no consequences', KS.generate_consequences_stated_on_screen === 'NONE_VISIBLE');
  t('so reversibility stays unknown', KS.generate_reversibility === 'UNKNOWN');
  t('and when the key is actually created stays unknown', KS.key_creation_moment === 'UNKNOWN');
  t('an absent warning is not a safety claim',
    KS.generate_reversibility !== 'REVERSIBLE' && KS.generate_reversibility !== 'SAFE');

  console.log('\nevidence contract: the crypto.com permission list as observed 2026-08-19');
  t('nine permissions', CC.permissions.length === 9);
  t('view balance & transactions is the only mandatory one',
    CC.mandatory.length === 1 && CC.mandatory[0] === 'View balance & transactions');
  t('the default grant is all nine', CC.default_grant.length === 9);
  t('and it includes cash withdrawals',
    CC.default_grant.indexOf('Make cash withdrawals') !== -1);
  t('the minimum observed grant is the mandatory one',
    CC.minimum_observed_grant.join() === 'View balance & transactions');
  t('eight permissions are removable', CC.permissions.length - CC.mandatory.length === 8);
  t('expiration offers exactly 30, 60 and 90 days',
    CRYPTO_COM_EXCHANGE.agent_key_setup.expiration_options.join() === '30 days,60 days,90 days');
  t('nothing shorter than 30 days',
    CRYPTO_COM_EXCHANGE.agent_key_setup.expiration_shortest_offered === '30 days');
  t('no instrument granularity is exposed in the agent key UI',
    CRYPTO_COM_EXCHANGE.agent_key_setup.permissions_instrument_granularity ===
      'NOT_EXPOSED_IN_AGENT_KEY_UI');
  t('execute trades product scope is unknown, not ALL',
    CC.product_scope_of_execution === 'UNKNOWN');
  t('and the absence is attributed to the UI',
    CC.product_scope_controls === 'NOT_EXPOSED_IN_AGENT_KEY_UI');
  t('with the observation recorded beside it', /single|one checkbox|Execute trades is one/
    .test(CC.product_scope_evidence));
  t('robinhood product scope is unknown too',
    ROBINHOOD_AGENTIC.credential_grant_model.product_scope_of_execution === 'UNKNOWN');
  t('robinhood exposes no per-credential surface',
    ROBINHOOD_AGENTIC.credential_grant_model.surface === 'NOT_EXPOSED');

  console.log('\nno crypto.com enforcement state was promoted');
  // Reading a settings screen and unchecking boxes proves configurability. It does not make
  // the venue an enforcer, and nothing here may quietly say otherwise.
  const caps = CRYPTO_COM_EXCHANGE.capabilities;
  t('spot execution still unverified', caps['spot.execute'] === 'UNVERIFIED');
  t('perpetual execution still unverified', caps['perpetual.execute'] === 'UNVERIFIED');
  t('the weekly budget is still only observed', caps.venue_trading_budget.indexOf('OBSERVED') === 0);
  t('key expiry is still only observed', caps.venue_key_expiry.indexOf('OBSERVED') === 0);
  t('key permissions are still only observed', caps.venue_key_permissions.indexOf('OBSERVED') === 0);
  t('withdrawal exclusion is excludable, not proven absent',
    caps.withdrawal_prohibition === 'OBSERVED_EXCLUDABLE_NOT_DEFAULT');
  const cm = issueMandate({
    issuer_identity: 'operator:test', subject_agent: 'a', capabilities: ['crypto.trade'],
    venues: ['crypto_com_exchange'], capital: { total_budget_usd: 5 },
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  }, CRYPTO_COM_EXCHANGE);
  t('budget enforcement remains UNVERIFIED', cm.enforcement.total_budget_usd === 'UNVERIFIED');
  t('expiry enforcement remains UNVERIFIED', cm.enforcement.expires_at === 'UNVERIFIED');

  console.log('\nofficial documentation, 2026-08-21 - DOCUMENTED is not enforcement');
  const DOC = CC.official_documentation;
  t('recorded at documentary strength', DOC.provenance === 'DOCUMENTED');
  t('and claims no enforcement', DOC.enforcement_claim === 'NONE');
  t('seven first-party sources, all crypto.com', DOC.sources.length === 7 &&
    DOC.sources.every(u => /^(help\.)?crypto\.com\//.test(u)));
  t('framed around the OpenClaw integration, not the venue at large',
    DOC.documented_for === 'OPENCLAW_INTEGRATION');
  t('market orders only', DOC.states.order_types === 'MARKET_ONLY');
  t('cryptocurrency only, more asset types to come',
    DOC.states.asset_scope === 'CRYPTOCURRENCY_ONLY_MORE_ASSET_TYPES_TO_COME');
  t('secret shown once at setup', DOC.states.secret_visibility === 'SHOWN_ONCE_AT_SETUP');
  t('rotation invalidates the old key immediately',
    /INVALIDATED_IMMEDIATELY/.test(DOC.states.rotation_effect));
  t('two expiry triggers, including inactivity', DOC.states.expiry_triggers.length === 2 &&
    DOC.states.expiry_triggers.some(x => /inactivity/.test(x)));
  t('portfolio balance documented as always enabled',
    DOC.states.always_enabled_permission === 'portfolio balance access');
  t('key revocation is documented as an API operation',
    DOC.states.kill_switch === 'API_KEY_REVOCATION_EXPOSED_AS_API_OPERATION');
  t('without any server-side enforcement claim',
    DOC.states.kill_switch_enforcement === 'NOT_STATED' &&
    DOC.states.kill_switch_in_flight_semantics === 'NOT_STATED');
  t('confirmation is agent-side, not a venue control',
    DOC.states.confirmation_mode === 'AGENT_SIDE_CLIENT_SETTING_NOT_VENUE_CONTROL');
  t('and the client-side opt-out is recorded',
    /memory.confirmation_required/.test(DOC.states.confirmation_mode_detail));
  t('documented rate limits recorded', DOC.states.rate_limits.trades_per_minute === 10 &&
    DOC.states.rate_limits.api_calls_per_minute === 100 &&
    DOC.states.rate_limits.on_exceed === 'HTTP_429');
  t('weekly limit scope is not stated', DOC.states.weekly_limit_scope === 'NOT_STATED');

  console.log('\ndocumentation did not move the posture');
  // The failure this guards against: reading "withdrawing funds is strictly off-limits" as
  // permission to relax. Robinhood's PRE_AUTHORIZED was recorded from documentation and a
  // five-surface search later found no mechanism behind it.
  t('withdrawal state unchanged by the docs',
    CRYPTO_COM_EXCHANGE.capabilities.withdrawal_prohibition === 'OBSERVED_EXCLUDABLE_NOT_DEFAULT');
  t('nothing promoted to VERIFIED_ENFORCED',
    !JSON.stringify(CRYPTO_COM_EXCHANGE).includes('VERIFIED_ENFORCED'));
  t('product scope still UNKNOWN despite the asset-scope statement',
    CC.product_scope_of_execution === 'UNKNOWN');
  t('order-type scope is not product scope',
    DOC.states.order_types === 'MARKET_ONLY' && CC.product_scope_of_execution === 'UNKNOWN');
  t('no default weekly limit is declared, only the range',
    CRYPTO_COM_EXCHANGE.agent_key_setup.weekly_limit_range_usd.join() === '1000,20000' &&
    CRYPTO_COM_EXCHANGE.agent_key_setup.weekly_limit_default_usd === undefined);

  console.log('\ncontradictions preserved, not resolved');
  const subj = DOC.contradictions.map(c => c.subject);
  t('three contradictions recorded', DOC.contradictions.length === 3);
  t('withdrawal authority among them', subj.indexOf('withdrawal authority') !== -1);
  t('permission count among them', subj.indexOf('permission count') !== -1);
  t('weekly limit default among them', subj.indexOf('weekly limit default') !== -1);
  t('none is marked resolved', DOC.contradictions.every(c => c.status === 'UNRESOLVED'));
  t('the withdrawal one keeps both documentary strengths', DOC.contradictions.some(c =>
    c.subject === 'withdrawal authority' && c.documented_strong && c.documented_weak &&
    c.observed));
  t('and states the posture is unchanged', DOC.contradictions.some(c =>
    c.subject === 'withdrawal authority' && /UNCHANGED/.test(c.posture)));

  console.log('\nresearch unknowns carry their reason');
  const RU = DOC.research_unknowns;
  t('substantive-but-silent is populated',
    RU.OFFICIAL_DOCUMENTATION_SUBSTANTIVE_BUT_SILENT_ON_THIS.length >= 6);
  t('including the load-bearing product question',
    RU.OFFICIAL_DOCUMENTATION_SUBSTANTIVE_BUT_SILENT_ON_THIS.some(x => /perpetuals/.test(x)));
  t('sparse is a separate reason',
    RU.OFFICIAL_DOCUMENTATION_SPARSE_OR_INSUFFICIENT.length >= 1);
  // Access was never the constraint. Recording that as empty is itself the finding - it
  // distinguishes "we looked and it is not documented" from "we could not look".
  t('nothing was unreachable', RU.OFFICIAL_SOURCE_UNREACHABLE_FROM_ENVIRONMENT.length === 0);
  t('the three reasons are distinct keys', Object.keys(RU).length === 3);

  console.log('\napp versus exchange: answered at surface level, open as a design decision');
  t('answered as distinct execution surfaces',
    CC.credential_model_attribution === 'DISTINCT_EXECUTION_SURFACES');
  t('the earlier unresolved state is kept, not overwritten',
    CC.credential_model_attribution_history.length === 2 &&
    /UNRESOLVED_APP_VS_EXCHANGE/.test(CC.credential_model_attribution_history[0]));
  // The caveat is the load-bearing part: two hosts is a surface claim, not an architecture
  // claim. Shared infrastructure beneath them is excluded by nothing we found.
  t('and carries the not-a-backend-claim caveat',
    CC.credential_model_caveat === 'EXECUTION_SURFACE_CLAIM_NOT_BACKEND_ARCHITECTURE_CLAIM');
  const ES = CC.execution_surfaces;
  t('two surfaces, two hosts', ES.app_agent_key.host === 'https://wapi.crypto.com' &&
    ES.exchange_api.host === 'https://api.crypto.com/exchange/v1/');
  t('the app host keeps its mediated read path',
    ES.app_agent_key.host_provenance === 'DOCUMENTED_VIA_SUMMARISING_FETCH_LAYER');
  t('the exchange host does not, because it was quoted directly',
    ES.exchange_api.host_provenance === 'DOCUMENTED_QUOTED_DIRECTLY');
  t('withdrawal families sit on the app surface',
    ES.app_agent_key.capability_families.indexOf('withdrawals') !== -1);
  t('and nowhere on the exchange surface',
    ES.exchange_api.order_methods.indexOf('private/create-order') !== -1 &&
    ES.exchange_api.mentions_agent_key === false);
  t('cross-acceptance stays unknown',
    ES.app_key_accepted_by_exchange_endpoints === 'UNKNOWN');
  t('shared backend stays unknown', ES.shared_backend_beneath_hosts === 'UNKNOWN');
  t('the withdrawal contradiction gained a fourth leg and stayed unresolved',
    DOC.contradictions.some(c => c.subject === 'withdrawal authority' &&
      c.technical_first_party && c.status === 'UNRESOLVED'));
  t('technical repository provenance is pinned to one owner, not to github',
    DOC.technical_repository_sources.repository === 'crypto-com/crypto-agent-trading' &&
    DOC.technical_repository_sources.owner === 'crypto-com');
  t('and it is kept out of the crypto.com web source list',
    DOC.sources.every(u => u.indexOf('github') === -1));
  t('the connector still declares the two surfaces differ',
    CRYPTO_COM_EXCHANGE.product_boundary.app_and_exchange_differ === true);
  t('and no split has been performed', CRYPTO_COM_EXCHANGE.connector === 'crypto_com_exchange');

  console.log('\nfive provenance levels, still distinct');
  // Visually confirmed, interaction-observed, inferred, unknown, verified-enforced. They
  // describe different amounts of knowledge and must not collapse into one another.
  const AKS = CRYPTO_COM_EXCHANGE.agent_key_setup;
  t('VISUALLY CONFIRMED  - the beta label and the permission sheet',
    CC.account_surface.agent_key_provenance === 'VISUALLY_CONFIRMED' &&
    AKS.permissions_list_visually_confirmed === true);
  t('INTERACTION OBSERVED - deselection, which no image could show',
    AKS.permissions_deselection === 'OBSERVED_INDIVIDUALLY_CONFIGURABLE' &&
    AKS.permissions_mandatory_visually_distinguishable === false);
  t('INFERRED             - the class mapping, from labels only',
    CC.class_requirements_state === 'INFERRED_FROM_PERMISSION_LABELS');
  t('UNKNOWN              - what Execute trades spans, and Generate',
    CC.product_scope_of_execution === 'UNKNOWN' &&
    AKS.generate_reversibility === 'UNKNOWN');
  t('VERIFIED ENFORCED    - reached by nothing, at either venue',
    TRADE.venue_enforcement === 'UNVERIFIED' && RH.venue_enforcement === 'NONE_EXPOSED');
  t('and no two of them share a value',
    new Set([CC.account_surface.agent_key_provenance, AKS.permissions_deselection,
             CC.class_requirements_state, CC.product_scope_of_execution,
             TRADE.venue_enforcement]).size === 5);

  console.log('\ntemporal expiry reconciliation is reserved, not implemented');
  // venue_expiry_floor_days is declared evidence. Consuming it needs a duration comparison
  // reconcileWithConnector does not have, and it stays unbuilt until its activation
  // condition - a VERIFIED expiry control - is met. This test exists so that stays true on
  // purpose rather than by neglect.
  t('the floor is declared', CRYPTO_COM_EXCHANGE.venue_expiry_floor_days === 30);
  t('and is not consumed by reconciliation', cm.enforcement.expires_at !== 'VENUE_BACKSTOP' &&
    cm.enforcement.expires_at !== 'VENUE_ALIGNED');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
