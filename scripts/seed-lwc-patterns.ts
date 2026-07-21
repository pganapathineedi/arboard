/**
 * Seed LWC-001 to LWC-008 (LWC failure patterns) into failure_patterns and grounding_embeddings.
 * Run: npm run seed:lwc-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const lwcFailurePatterns = [
  {
    id: "LWC-001",
    title: "Imperative Apex called in connectedCallback without a loading state — blank UI on slow networks and double-invoke risk",
    scenario:
      "A Lightning Web Component displays account details by calling an imperative Apex method in connectedCallback. The developer writes `connectedCallback() { getAccountDetails({ id: this.recordId }).then(result => { this.account = result; }); }` with no loading indicator and no error handling. On a fast internal network during development, the data arrives in under 200ms and the component appears to render correctly. In production, a field sales user on a 4G connection experiences a 2-second blank white component before data appears — there is no spinner, no skeleton screen, and no message. Additionally, the component is embedded in a tab that users navigate away from and back to. Each navigation reconnects the DOM, firing connectedCallback again. If the user navigates back quickly, two concurrent Apex calls race each other and the component settles on whichever response arrives last — which is not always the most recent call. When the Apex method eventually throws a permission error for a restricted account, the promise rejection is unhandled, the component stays blank forever, and the browser console shows an uncaught promise error that the user never sees.",
    better_path:
      "Introduce an `isLoading` boolean property initialised to `true`, and render a `<lightning-spinner>` conditionally on `isLoading`. Introduce an `error` property rendered as a user-facing error message when set. Wrap the imperative call in try/catch/finally: set `isLoading = false` in `finally` so it clears regardless of success or failure. To prevent race conditions on reconnect, store the promise result only if the component is still connected — set a `_connected` flag in connectedCallback to `true` and in disconnectedCallback to `false`, and discard the result if `_connected` is false when the promise resolves. For data that should reload when the record context changes, prefer a `@wire` adapter over an imperative connectedCallback call — the wire framework handles re-fetch on property change automatically.",
    severity: "high",
    components: ["LWC", "Apex", "connectedCallback"],
    tags: ["lwc", "imperative-apex", "connectedCallback", "loading-state", "error-handling", "sf-lwc"],
    source: "sf-lwc",
  },
  {
    id: "LWC-002",
    title: "@api property mutated directly in child component — breaks one-way data flow and causes unpredictable parent state",
    scenario:
      "A parent component passes a record object to a child via an `@api record` property. The child component receives the object and, when the user edits a field, directly mutates the shared object: `this.record.status = 'Active'`. In JavaScript, objects are passed by reference, so the mutation silently modifies the same object the parent holds in memory. The parent's state now reflects a change the parent never explicitly made. In this specific implementation, the parent uses the record object to determine whether to show a Save button — because the child silently mutated the status, the parent's computed property detects a change and shows the Save button before the user has confirmed anything. When the parent later tries to detect 'dirty' state by comparing the current record to the original, they are identical — both point to the same mutated object — so no dirty-state detection works. The child also decorates the `@api` property with `@track`, which makes the mutation propagate reactively but masks the underlying architectural violation.",
    better_path:
      "A child component must never mutate an `@api` property. The `@api` property is owned by the parent and the child is only a consumer. When a child needs to transform or extend the incoming data for its own rendering, it creates a local copy in the getter or in connectedCallback: `this._localRecord = { ...this.record }`. All mutations operate on `_localRecord`. When the user confirms a change, the child fires a CustomEvent carrying the updated data as the `detail` payload: `this.dispatchEvent(new CustomEvent('recordchange', { detail: { ...this._localRecord } }))`. The parent receives the event, validates the payload, and decides whether to update its own state. This preserves one-way data flow, makes dirty-state detection reliable, and keeps the parent as the single source of truth for the record.",
    severity: "high",
    components: ["LWC", "@api", "Reactivity"],
    tags: ["lwc", "@api", "mutation", "one-way-data-flow", "reactivity", "sf-lwc"],
    source: "sf-lwc",
  },
  {
    id: "LWC-003",
    title: "CSS class hardcoded with pixel values and brand colours instead of SLDS tokens — fails brand compliance and breaks SLDS2 density",
    scenario:
      "A developer builds a custom LWC card component and styles it directly in the component's CSS file: `.card-header { color: #0070d2; font-size: 16px; padding: 12px; border-bottom: 1px solid #dddbda; }`. The component is deployed to an Experience Cloud site where the client's brand team has configured a custom theme with a teal primary colour and a compact density setting. Because the component uses hardcoded hex values rather than SLDS design tokens, it ignores the theme entirely — the header stays Salesforce blue even though every other element on the page is teal. The compact density setting reduces standard SLDS component padding, but the `12px` padding hardcoded in the CSS does not respond to the density variable, creating a visual inconsistency. During the brand compliance review before go-live, the design team flags 11 separate violations in this single component, requiring a full CSS rewrite. The same component is also used inside the standard Lightning App Builder where a client admin later enables the new SLDS2 design language — the hardcoded values now clash with the updated token system and must be re-addressed.",
    better_path:
      "Replace all hardcoded values with SLDS2 styling hooks (CSS custom properties) so the component inherits the active theme and density settings. Replace `color: #0070d2` with `color: var(--slds-g-color-brand-base-50)`. Replace `font-size: 16px` with `font-size: var(--slds-g-font-size-5)`. Replace `padding: 12px` with `padding: var(--slds-g-spacing-3)`. Replace the border colour with `border-color: var(--slds-g-color-border-base-1)`. For structural layout, use SLDS utility classes (`slds-p-around_small`, `slds-text-heading_small`) directly in the template HTML rather than writing custom CSS at all. When a customer theme is active, the custom properties resolve to the theme values automatically — the component requires no CSS changes to match a new brand. Document the SLDS2 token catalogue reference in the component README for future maintainers.",
    severity: "medium",
    components: ["LWC", "SLDS", "CSS"],
    tags: ["lwc", "SLDS", "SLDS2", "styling-hooks", "CSS", "hardcoded", "sf-lwc"],
    source: "sf-lwc",
  },
  {
    id: "LWC-004",
    title: "renderedCallback used for data fetching — triggers infinite re-render loop on every state update",
    scenario:
      "A developer needs to load additional metadata after a component renders. They place an imperative Apex call inside `renderedCallback()`: `renderedCallback() { getMetadata().then(result => { this.metadata = result; }); }`. On the first render, `renderedCallback` fires and calls `getMetadata()`. The promise resolves and sets `this.metadata = result`, which triggers a reactive state update. A reactive state update causes the LWC framework to re-render the component. After re-render, `renderedCallback` fires again, calling `getMetadata()` again. The promise resolves again, `this.metadata` is set again — another re-render, another `renderedCallback` call. This loop runs indefinitely, generating hundreds of Apex calls per second. In the developer's local org with fast Apex execution, the loop runs so fast the browser tab freezes and requires a force-close. In a production org with slower Apex, the loop is slower but still fires 3–5 Apex calls per second, saturating the Apex per-user rate limit and generating cost. The browser performance tab shows `renderedCallback` executing every 200–400ms. No error is thrown — the component appears to render correctly on first paint while the loop continues in the background.",
    better_path:
      "Never fetch data in `renderedCallback`. Use `renderedCallback` only for one-time DOM setup operations that cannot be done until the component has rendered — initialising a third-party charting library, measuring DOM element dimensions, or setting up a ResizeObserver. Guard every `renderedCallback` body with a boolean flag: `if (this.hasRendered) return; this.hasRendered = true;` — this ensures the body executes exactly once per component lifecycle. For data that should load when the component connects to the DOM, use `connectedCallback` for a one-shot imperative call, or `@wire` for reactive data that reloads when parameters change. If data must be fetched after a specific user interaction or DOM event, call the Apex method from the event handler directly — not from the lifecycle hook.",
    severity: "high",
    components: ["LWC", "renderedCallback", "Performance"],
    tags: ["lwc", "renderedCallback", "infinite-loop", "performance", "lifecycle", "sf-lwc"],
    source: "sf-lwc",
  },
  {
    id: "LWC-005",
    title: "Cross-component communication via DOM querySelector instead of LMS or CustomEvents — breaks under Lightning Web Security",
    scenario:
      "A developer has two LWC components on the same App Builder page — a search bar component and a results list component. They are siblings in the DOM tree with no shared parent. To send the search term from the search bar to the results list, the developer uses `document.querySelector('c-results-list').searchTerm = value`. In the developer's scratch org, the component is enabled with an older Locker Service configuration and the querySelector reaches across shadow DOM boundaries without error. The integration appears to work in dev and system testing. When deployed to the client's production org, which has Lightning Web Security (LWS) enabled at the org level, `document.querySelector('c-results-list')` returns `null` — LWS enforces strict shadow DOM isolation and prevents cross-component DOM traversal at the document level. The search bar no longer communicates to the results list at all, and the feature is completely broken in production. The defect is not caught in testing because no test environment had LWS enabled to match production.",
    better_path:
      "Use Lightning Message Service (LMS) for communication between components that do not share a parent-child relationship. Create a Message Channel metadata file (`SearchChannel.messageChannel-meta.xml`). In the search bar, publish the search term when the user submits: `publish(this.messageContext, SEARCH_CHANNEL, { searchTerm: this.searchTerm })`. In the results list, subscribe in `connectedCallback` and unsubscribe in `disconnectedCallback`. LMS is the official Salesforce-supported cross-component messaging API — it works across shadow DOM boundaries, across different DOM trees on App Builder pages, and in Experience Cloud with the correct scope setting. For parent-to-child communication, use `@api` properties. For child-to-parent communication, use `CustomEvent` dispatched upward. Never use `document.querySelector`, `window.postMessage`, or global event listeners to communicate across LWC components.",
    severity: "critical",
    components: ["LWC", "LMS", "Lightning Web Security"],
    tags: ["lwc", "LMS", "cross-component", "querySelector", "LWS", "locker-service", "sf-lwc"],
    source: "sf-lwc",
  },
  {
    id: "LWC-006",
    title: "Wire adapter missing error branch — Apex failure renders a silent blank UI with no user feedback",
    scenario:
      "A component uses `@wire(getContactList, { accountId: '$recordId' }) contacts;` and the template renders `<template for:each={contacts.data} for:item='contact'>`. The developer tests the component by loading an Account record that always returns contacts — the component displays the list correctly and passes code review. The wire adapter also has an `error` property on the result object, but the developer assumes errors won't happen in production because the Apex method is simple. In production, a subset of Account records belong to a record type where the user's profile lacks read access to a required field. For those records, the Apex method throws a `NoAccessException`. The wire adapter sets `contacts.error` and leaves `contacts.data` undefined. Because the template only renders `contacts.data` and has no `error` branch, the component renders completely blank — no list, no loading indicator, no error message. The user sees an empty card and files a support ticket. The support team has no way to diagnose the issue from the UI. The error appears only in the browser console, which field users never see.",
    better_path:
      "Every `@wire` adapter result must handle both `data` and `error` branches explicitly, both in the template and in the JS controller. In the template, add a conditional error display: `<template if:true={contacts.error}><p class='slds-text-color_error'>Unable to load contacts. Please refresh or contact your administrator.</p></template>`. In the JS, use the object form of the wire decorator to handle both paths: `@wire(getContactList, { accountId: '$recordId' }) wiredContacts({ data, error }) { if (data) { this.contacts = data; this.error = undefined; } else if (error) { this.error = error; this.contacts = undefined; } }`. Log the error detail to a custom Platform Event or Apex error log for operational visibility. The error branch is not an edge case — network failures, permission errors, and governor limit exceptions all route through the wire error path in production.",
    severity: "high",
    components: ["LWC", "@wire", "Error Handling"],
    tags: ["lwc", "@wire", "error-handling", "wire-adapter", "UX", "sf-lwc"],
    source: "sf-lwc",
  },
  {
    id: "LWC-007",
    title: "Jest test with no wire adapter mock — test throws undefined error and requires real org connection to pass",
    scenario:
      "A developer writes a Jest test for an LWC that uses `@wire(getAccountList)` to populate a data table. The test file imports the component, creates it with `createElement`, and asserts that a `<lightning-datatable>` is rendered. The developer does not mock the wire adapter. When Jest runs, the `@wire` decorator fires in the test context. Without a mock, the wire result is `{ data: undefined, error: undefined }` — the adapter never emits any value. The template's `if:true={accounts.data}` block evaluates to false, the datatable never renders, and the assertion `expect(element.shadowRoot.querySelector('lightning-datatable')).not.toBeNull()` fails. The developer attempts to fix this by commenting out the assertion and marking the test as passing, reducing the test to zero meaningful assertions. In a second case, the developer imports the Apex method directly in the test and tries to call it: the test runner throws `TypeError: getAccountList is not a function` because the `@salesforce/apex` module is not available in the Jest Node.js environment and the stub is missing from `jest.config.js`.",
    better_path:
      "Every `@wire` adapter used in the component under test must be mocked using `@salesforce/sfdx-lwc-jest`'s `registerApexTestWireAdapter` or `registerLdsTestWireAdapter`. Import the wire adapter in the test file and register it before the describe block. In each test case, call `adapter.emit({ data: [...], error: undefined })` to simulate a successful wire result, or `adapter.error()` to simulate a failure. After emitting, call `await Promise.resolve()` (or `flushPromises()`) to flush the microtask queue before asserting. Every component with a `@wire` adapter must have at minimum two Jest tests: one for the success path (emit data, assert rendered output) and one for the error path (emit error, assert error message is rendered). Register all `@salesforce/apex/*` module stubs in `jest.config.js` under `moduleNameMapper` so the test runner resolves them without a real org connection.",
    severity: "high",
    components: ["LWC", "Jest", "Testing"],
    tags: ["lwc", "jest", "wire-mock", "testing", "apex-mock", "sf-lwc"],
    source: "sf-lwc",
  },
  {
    id: "LWC-008",
    title: "Component re-renders entire list on a single item change due to missing or unstable key directive",
    scenario:
      "A component renders a list of 500 opportunity line items using `<template for:each={lineItems} for:item='item'>`. The developer omits the `key` directive entirely, which means the LWC framework cannot track which DOM nodes correspond to which data items. When the user edits the quantity field on a single line item and the component's state updates, the LWC framework has no identity information for the list items and must perform a full DOM diff across all 500 rows. With 500 rows, this full re-render takes 800ms on a mid-range laptop, causing a perceptible lag after every field edit. The user perceives the table as slow and unresponsive. In a second scenario, the developer adds a `key={item.index}` where `index` is the array position rather than a unique identifier. When the user reorders rows (drag and drop) or filters the list, the array indices shift. The framework matches the new item at index 0 to the old DOM node at index 0, which is wrong — the DOM node retains stale event listeners from the previous item. Reordering the list causes checkbox states and input values to appear on the wrong rows.",
    better_path:
      "Always provide a stable, unique `key` directive on every iterated element. Use the record's Salesforce ID or a system-assigned unique identifier — never use the array index as the key. The correct pattern is `<template for:each={lineItems} for:item='item' key={item.Id}>`. With a stable unique key, the LWC framework can identify which DOM node corresponds to which data record, perform a minimal diff, and update only the changed node — leaving all other 499 nodes untouched. For large lists (>200 rows), combine unique keys with an infinite scroll or pagination pattern: render only the first page of rows on initial load and append additional pages as the user scrolls. For lists where individual item state changes frequently (inline editing), consider splitting each row into its own child component — this scopes re-renders to the individual row component rather than the entire list.",
    severity: "medium",
    components: ["LWC", "Performance", "Rendering"],
    tags: ["lwc", "key-directive", "performance", "rendering", "for:each", "sf-lwc"],
    source: "sf-lwc",
  },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedText(text: string): Promise<number[]> {
  if (!VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY env var is required");

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [text], model: "voyage-code-3", input_type: "document" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[seed-lwc-patterns] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-lwc-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of lwcFailurePatterns) {
    const { error } = await sb
      .from("failure_patterns")
      .upsert(pattern, { onConflict: "id" });

    if (error) {
      console.error(`  [failure_patterns] Failed to upsert ${pattern.id}: ${error.message}`);
    } else {
      console.log(`  [failure_patterns] Upserted ${pattern.id}`);
      patternCount++;
    }
  }

  // Step 2: embed and upsert into grounding_embeddings
  let embeddingCount = 0;
  for (const pattern of lwcFailurePatterns) {
    const combinedText = `${pattern.title}\n\n${pattern.scenario}\n\n${pattern.better_path}`;

    console.log(`  [grounding_embeddings] Embedding ${pattern.id}…`);
    const embedding = await embedText(combinedText);

    const { error } = await sb.from("grounding_embeddings").upsert(
      {
        source_id: pattern.id,
        content_type: "failure_pattern",
        chunk_text: combinedText,
        metadata: {
          domain: "salesforce",
          chunk_index: 0,
          agent_hints: ["sf-lwc"],
          tags: pattern.tags,
        },
        embedding,
      },
      { onConflict: "source_id" }
    );

    if (error) {
      console.error(`  [grounding_embeddings] Failed to upsert ${pattern.id}: ${error.message}`);
    } else {
      console.log(`  [grounding_embeddings] Upserted ${pattern.id}`);
      embeddingCount++;
    }

    await delay(VOYAGE_DELAY_MS);
  }

  console.log(
    `\nSeeded ${patternCount} failure patterns to failure_patterns, ${embeddingCount} embeddings to grounding_embeddings`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
