# LWC Specialist — Review Checklist

## Component Architecture & Composition

**Single responsibility principle:**
- Each LWC should do one thing well — a component exceeding ~300 lines is a strong signal for decomposition
- Split by concern: a container component fetches data and manages state; presentational child components render it
- Parent owns state; child owns presentation — data flows down via `@api` properties, events flow up via `dispatchEvent`
- No side effects in a component that is "just UI" — side effects (Apex calls, navigation) belong in the container

**Composition patterns:**
- Use `<slot>` for content projection; named slots for multi-region layouts
- Prefer shallow component trees — deeply nested `@api` chains are fragile and hard to debug
- Avoid "god components" that embed navigation logic, data fetching, form validation, and rendering all in one file
- Design child component APIs (`@api` properties and events) as explicit contracts — document what the child expects and what events it fires

**Parent ↔ child communication:**
- Parent → child: `@api` property binding (`<c-child value={data}>`)
- Child → parent: `CustomEvent` dispatched via `this.dispatchEvent(new CustomEvent('eventname', { detail: payload }))`, caught via `oneventname` on parent
- Never reach into a child's internals via `this.template.querySelector` to set values — this bypasses the reactive contract and breaks Locker Service / LWS

## Reactivity Model — @track, @api, @wire

**@api — public properties:**
- `@api` marks a property as publicly settable by the parent — it is also reactive (re-renders when the value changes)
- **NEVER mutate an `@api` property inside the component that declares it** — it is owned by the parent; mutation breaks one-way data flow and produces unpredictable state
- Primitive `@api` values (String, Number, Boolean) are safe to use directly
- Object/Array `@api` values: component must treat them as read-only; create a local copy before mutating

**Reactivity for objects and arrays (immutable update pattern):**
- Assigning a new reference triggers re-render; mutating a nested property on the same object reference does NOT
- Correct pattern for array update:

```js
// WRONG — mutation does not trigger re-render
this.items[0].name = 'updated';

// CORRECT — new array reference triggers re-render
this.items = this.items.map((item, i) => i === 0 ? { ...item, name: 'updated' } : item);
```

- Correct pattern for object update:

```js
// CORRECT — spread creates a new reference
this.record = { ...this.record, status: 'Active' };
```

**@track — when to use:**
- In API v39+ (all modern LWC), plain properties are deeply reactive by default — `@track` is rarely needed
- `@track` forces deep reactivity on an object/array so nested property mutations trigger re-render — use only when you must mutate in place and cannot use the immutable pattern
- Never use `@track` on primitives — it has no additional effect and misleads reviewers

**@wire — reactive wiring:**
- Wire adapters re-execute whenever reactive source properties change — any `@api` or reactive property used as a wire parameter is a dependency
- Wire result is always `{ data, error }` — both branches must be handled explicitly in the template and in JS
- Wire does not fire in `connectedCallback` order — do not assume execution sequence relative to lifecycle hooks
- Wire data is read-only — never mutate `this.wireResult.data` directly

## Wire Service vs Imperative Apex

**Wire adapter (preferred for reads):**

```js
import getAccount from '@salesforce/apex/AccountController.getAccount';
import { wire } from 'lwc';

@wire(getAccount, { accountId: '$recordId' })
wiredAccount({ data, error }) {
    if (data) {
        this.account = data;
        this.error = undefined;
    } else if (error) {
        this.error = error;
        this.account = undefined;
    }
}
```

- Use for data that should reload when record context changes
- Always handle both `data` and `error` — a missing `error` branch leaves the UI blank on failure with no user feedback
- `$` prefix on a parameter makes it reactive — the wire re-fires when that property changes

**Imperative Apex (for mutations or conditional fetches):**

```js
import saveRecord from '@salesforce/apex/AccountController.saveRecord';

async handleSave() {
    this.isLoading = true;
    this.error = undefined;
    try {
        await saveRecord({ accountId: this.recordId, data: this.formData });
        this.dispatchEvent(new ShowToastEvent({ title: 'Saved', variant: 'success' }));
    } catch (error) {
        this.error = error;
    } finally {
        this.isLoading = false;
    }
}
```

- **Never call imperative Apex in `connectedCallback` without a loading guard** — the component renders before the promise resolves; missing loading state causes blank flash or double-fetch on reconnect
- Always set `isLoading = true` before the call and `false` in `finally` — never only in `try`
- Handle errors in `catch` — unhandled promise rejections are silent in production

**Selection guide:**

| Scenario | Use |
|----------|-----|
| Display data that reloads when record context changes | `@wire` |
| Search or filter triggered by user action | Imperative |
| Any DML (insert, update, delete) | Imperative |
| Apex method requires conditional params not available at component load | Imperative |
| Caching at wire adapter level is acceptable | `@wire` |

## Cross-Component Communication

**Decision matrix:**

| Scenario | Pattern |
|----------|---------|
| Parent-to-child data passing | `@api` property |
| Child-to-parent notification | `CustomEvent` dispatched upward |
| Sibling components on the same page | Lightning Message Service (LMS) |
| Any unrelated component (different DOM tree, different app page) | LMS |
| Simple pub/sub within a tightly owned component tree | `pubsub` module (community pattern, limited) |

**Lightning Message Service (LMS) — cross-DOM communication:**
- Correct for Experience Cloud, App Builder pages, and cases where components are not in a shared DOM tree
- Requires a Message Channel metadata file (`*.messageChannel-meta.xml`)
- Subscribe in `connectedCallback`, unsubscribe in `disconnectedCallback` — failure to unsubscribe causes memory leaks

```js
import { subscribe, unsubscribe, MessageContext } from 'lightning/messageService';
import MY_CHANNEL from '@salesforce/messageChannel/MyChannel__c';

@wire(MessageContext) messageContext;

connectedCallback() {
    this.subscription = subscribe(this.messageContext, MY_CHANNEL, (msg) => {
        this.handleMessage(msg);
    });
}

disconnectedCallback() {
    unsubscribe(this.subscription);
    this.subscription = null;
}
```

- **Experience Cloud scoping**: LMS channels must use `ACTIVE_TAB` or `APPLICATION` scope — verify the scope matches the routing model
- Never use `document.dispatchEvent` or global event listeners to communicate across components — violates Locker Service and fails in LWS-strict mode

**Custom events:**
- Event names must be all lowercase — `myevent` not `myEvent`
- Use `{ bubbles: true, composed: true }` only when the event must cross shadow DOM boundaries — not needed for direct parent-child communication
- Include a typed `detail` payload — document the shape in a comment on the event dispatch

**Anti-pattern — DOM traversal:**
- `this.template.querySelector('c-sibling')` reaches into a sibling's internals — prohibited by Locker Service; works in dev, breaks in production orgs with LWS
- `window.postMessage` for cross-component communication — not LWS-safe and couples components to the global scope

## SLDS2 Styling & Styling Hooks

**Styling principles:**
- Use SLDS utility classes for all spacing, typography, and layout — never hardcode pixel values, colours, or font sizes in CSS
- Use SLDS2 styling hooks (CSS custom properties) for theming customisation — override at the component level without breaking SLDS cascade

```css
/* WRONG — hardcoded colour */
.my-header { color: #0070d2; }

/* CORRECT — SLDS token via styling hook */
.my-header { color: var(--slds-g-color-brand-base-50); }
```

**Styling hook categories (SLDS2):**
- Global tokens: `--slds-g-color-*`, `--slds-g-spacing-*`, `--slds-g-font-*`
- Component-level overrides: `--slds-c-button-*`, `--slds-c-input-*`, etc.
- Prefer global tokens for custom components; component tokens for overriding base SLDS components

**CSS scoping:**
- LWC applies automatic CSS scoping — styles defined in a component's CSS file are scoped to that component's shadow DOM
- Do not use `:global()` to leak styles into child components — pass data or use styling hooks instead
- `@apply` is deprecated — migrate any legacy usage to individual CSS custom properties

**Common violations:**
- Inline `style` attributes with hardcoded values: `style="color: red"` — use a CSS class with a styling hook
- `!important` overrides — indicates a styling model violation; restructure instead
- Base component styling overridden via `::slotted` or deprecated shadow-piercing selectors

## Accessibility

**ARIA requirements:**
- Every interactive element that is not a native HTML element (`<button>`, `<a>`, `<input>`) must have `role` and `aria-label` / `aria-labelledby`
- Icon-only buttons: `<lightning-button-icon>` must have `alternative-text` set; custom icon buttons need `aria-label`
- Dynamic content updates must set `aria-live="polite"` or `aria-live="assertive"` on the container so screen readers announce changes

**Keyboard navigation:**
- Every clickable element must be reachable and operable via keyboard (Tab, Enter, Space)
- Custom list navigation (arrow keys within a listbox or menu) requires `keydown` handler implementing the ARIA keyboard interaction model
- Focus must be managed explicitly on modal open/close — trap focus inside modal; restore focus to trigger element on close

```js
// Focus management on modal open
connectedCallback() {
    // After modal renders
    this.template.querySelector('[data-id="modal-close"]').focus();
}
```

**Focus management:**
- Do not use `tabindex="0"` on non-interactive elements without adding keyboard event handlers
- `tabindex="-1"` to programmatically focus an element that should not be in the natural tab order
- Never remove focus indicators (`outline: none`) without providing an equivalent visible alternative

**WCAG 2.1 AA baseline:**
- Colour contrast ratio ≥ 4.5:1 for text; ≥ 3:1 for large text — do not use SLDS tokens that fall below this threshold
- Form inputs must have associated `<label>` or `aria-label` — placeholder alone does not satisfy the requirement
- Error messages must be associated with the input via `aria-describedby` — not only colour-coded

## Jest Test Standards

**Mock all wire adapters:**
- Never let a test reach real Apex or real org data — Jest tests run in Node.js, not on a Salesforce instance
- Use `@salesforce/sfdx-lwc-jest` test utilities and `@wire` mock APIs

```js
import { createElement } from 'lwc';
import MyComponent from 'c/myComponent';
import { registerApexTestWireAdapter } from '@salesforce/sfdx-lwc-jest';
import getAccount from '@salesforce/apex/AccountController.getAccount';

const getAccountAdapter = registerApexTestWireAdapter(getAccount);

describe('MyComponent', () => {
    let element;
    beforeEach(() => {
        element = createElement('c-my-component', { is: MyComponent });
        document.body.appendChild(element);
    });
    afterEach(() => { document.body.removeChild(element); });

    it('displays account name on wire success', async () => {
        getAccountAdapter.emit({ Id: '001xx', Name: 'Test Account' });
        await Promise.resolve(); // flush async queue
        const header = element.shadowRoot.querySelector('h1');
        expect(header.textContent).toBe('Test Account');
    });

    it('displays error message on wire failure', async () => {
        getAccountAdapter.error();
        await Promise.resolve();
        const error = element.shadowRoot.querySelector('[data-id="error"]');
        expect(error).not.toBeNull();
    });
});
```

**Mock imperative Apex:**

```js
jest.mock('@salesforce/apex/AccountController.saveRecord', () => ({
    default: jest.fn()
}), { virtual: true });

import saveRecord from '@salesforce/apex/AccountController.saveRecord';
// In test: saveRecord.mockResolvedValue({ success: true });
//          saveRecord.mockRejectedValue(new Error('Server error'));
```

**Jest test requirements:**
- Every wire adapter used in the component must have both success and error test cases
- Every imperative Apex call must have both resolved and rejected mock test cases
- Test user interactions: `element.shadowRoot.querySelector('button').click(); await Promise.resolve()`
- Do not `await new Promise(resolve => setTimeout(resolve, 0))` as a general flush — use `flushPromises()` from `@lwc/jest-utils`
- Coverage target: test all conditional render branches (`if:true`, `if:false`, iteration with/without data)

**Anti-patterns in LWC Jest:**
- `document.querySelector` instead of `element.shadowRoot.querySelector` — bypasses shadow DOM, produces false positives
- No `afterEach` cleanup — DOM leaks between tests produce false negatives and flaky failures
- Asserting implementation details (internal property values) instead of rendered output — couples tests to implementation

## Performance

**renderedCallback pitfalls:**
- `renderedCallback` fires after every render cycle — any state change inside it triggers another render, creating an infinite loop
- Guard all state-changing operations in `renderedCallback` with a `hasRendered` boolean flag:

```js
renderedCallback() {
    if (this.hasRendered) return;
    this.hasRendered = true;
    // One-time DOM setup (e.g. third-party library init)
}
```

- Never fetch data in `renderedCallback` — use `connectedCallback` for one-time imperative fetches or `@wire` for reactive fetches
- `renderedCallback` is the correct place for one-time third-party DOM library initialisation — guard it

**Lazy loading:**
- Use dynamic `import()` for heavy child components or large libraries not needed on initial render
- Split large feature areas into separate LWCs loaded conditionally with `if:true` / `lwc:if`
- Prefer `lightning-datatable` lazy loading options over rendering thousands of rows in a single template iteration

**Large list rendering:**
- Always use a unique, stable `key` directive on iterated elements — missing or unstable keys cause full list re-renders on any item change
- For lists >200 rows, implement virtual scrolling (infinite scroll pattern):
  - Load first page on `connectedCallback`; listen for scroll events to load subsequent pages
  - Use `IntersectionObserver` to detect when the last visible row is near the bottom, then fetch the next page
- Avoid `forEach` building complex DOM strings in JavaScript — use template `for:each` directives

**Anti-pattern — 30s polling:**
- `setInterval` polling is a resource drain; replace with Platform Events or Streaming API subscriptions for real-time updates
- If polling is unavoidable, clear the interval in `disconnectedCallback` to prevent leaks

**connectedCallback vs constructor:**
- `constructor`: initialise local JS state only; never query the DOM or call Apex here — the DOM is not yet available
- `connectedCallback`: safe for one-time setup, event subscriptions, imperative Apex calls; fires each time the component connects to the DOM (including re-connection after removal)
- `disconnectedCallback`: clean up subscriptions, timers, and LMS subscriptions

## Security

**Locker Service / Lightning Web Security (LWS):**
- Do not access `window`, `document`, or `parent` directly to manipulate cross-component DOM — blocked by Locker Service in older APIs; blocked more strictly by LWS in newer API versions
- `this.template.querySelector` is the only safe DOM traversal — scoped to the component's shadow root
- Third-party libraries must be vetted for LWS compatibility — libraries that use native `document.querySelector` or global event listeners may break in LWS-strict mode
- `eval()`, `Function()`, and dynamic script injection are blocked by Locker Service unconditionally

**Navigation — use NavigationMixin:**

```js
import { NavigationMixin } from 'lightning/navigation';

export default class MyComponent extends NavigationMixin(LightningElement) {
    navigateToRecord() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: this.recordId, actionName: 'view' }
        });
    }
}
```

- **Never use `window.location.href` or `window.location.replace()`** for navigation — breaks Experience Cloud routing, App Builder page history, and mobile app wrappers
- `NavigationMixin` is the only Salesforce-supported navigation API — it handles LEX, Experience Cloud, and mobile context correctly
- For external URLs, use `{ type: 'standard__webPage', attributes: { url: externalUrl } }` — never open with `window.open()` inside components that must work in mobile containers

**`@salesforce/user` and permission checks:**
- Use `@salesforce/user/Id` to get current user ID — do not read from the DOM or session
- For permission-gated UI, use `@salesforce/userPermission/PermissionName` and `@salesforce/customPermission/CustomPermissionName`
- Never trust client-side permission checks as the sole security gate — all Apex entry points must enforce CRUD/FLS/sharing independently

**Guest user exposure:**
- Components accessible to Experience Cloud guest users must not expose fields the guest profile cannot read
- Do not render any `@api` property that contains PII without an explicit FLS check at the Apex layer

## Common Failure Modes in LWC Delivery

1. **Imperative Apex in connectedCallback without loading state** — component appears blank on slow networks; user triggers a second action while the first Apex call is pending; double-invoke with no spinner
2. **@api property mutated in child** — parent state becomes inconsistent; re-render loops are possible; downstream parent state management breaks silently
3. **Hardcoded CSS colour or pixel value** — fails brand compliance review; breaks Experience Cloud theme overrides; does not respect SLDS2 density settings
4. **Data fetch in renderedCallback** — every state update triggers renderedCallback → Apex call → state update → re-render → loop; infinite re-render crashes the component
5. **DOM querySelector for cross-component communication** — works in dev scratch org; blocked by LWS in production; component silently fails in Experience Cloud or mobile
6. **Wire adapter missing error branch** — Apex failure returns blank UI with no message; user sees empty screen and cannot self-serve; error never surfaced in dev because dev data always returns
7. **Jest test without wire mock** — test throws "Cannot read property 'data' of undefined"; test suite requires an org connection; CI fails on every run
8. **Non-keyed iteration on large list** — every item change causes full DOM diff and re-render of all rows; at 500 rows this produces perceptible lag; degrades to multi-second render at 2000 rows

## MANDATORY CHECK LIST

1. Wire adapter results handle both `data` and `error` branches explicitly — no missing error state UI
2. `@api` properties never mutated inside the declaring component — one-way data flow enforced; local copy created before any mutation
3. Immutable update pattern used for object/array state changes — new reference assigned, not nested property mutation
4. `@track` used only where in-place mutation is required and immutable pattern is not feasible — not used on primitives
5. `renderedCallback` guarded with a `hasRendered` flag — no data fetching or unconditioned state changes inside it
6. Imperative Apex calls wrapped in try/catch/finally — `isLoading` set to `false` in `finally`; error state rendered to user
7. All LMS subscriptions unsubscribed in `disconnectedCallback` — no `setInterval` timers left running after component removal
8. Cross-component communication uses LMS (unrelated components) or CustomEvent (parent-child) — no `document.dispatchEvent` or DOM `querySelector` reaching into siblings
9. Navigation uses `NavigationMixin` exclusively — no `window.location.href` or `window.open`
10. All interactive elements have ARIA labels; icon-only buttons have `alternative-text` — keyboard navigation confirmed for every custom control
11. SLDS utility classes or SLDS2 styling hooks used for all styling — no hardcoded colours, pixel values, or `!important` overrides
12. Every Jest test mocks all wire adapters and imperative Apex calls — no real org connection required to run the suite
13. Jest tests cover both success and error paths for every wire adapter and imperative Apex call
14. Large list iterations use a stable unique `key` directive — no missing or array-index keys
15. Guest-accessible components confirmed to not expose fields beyond guest profile FLS — Apex layer enforces CRUD/FLS
16. Component does not exceed ~300 lines without documented decomposition rationale — no monolithic LWC

## SEVERITY RUBRIC

| Severity | Definition | This-domain examples |
|----------|-----------|----------------------|
| CRITICAL | Production failure, data loss, security breach, or compliance violation. Block go-live. | Guest-user-accessible component exposes fields without Apex-layer FLS enforcement — unauthenticated user reads restricted PII (data breach); `window.location.href` navigation breaks Experience Cloud routing — all navigation fails in production portal; Locker Service / LWS violation causes runtime exception — component completely non-functional in production org |
| HIGH | Performance, scalability, or maintainability risk. Will surface under load or growth. | Wire adapter missing `error` branch — Apex failure renders a silent blank UI with no user feedback; `@api` property mutated internally — breaks parent state management and causes unpredictable cascading re-renders; `renderedCallback` used for data fetching — infinite re-render loop crashes the component on any data change; LMS subscription not unsubscribed in `disconnectedCallback` — memory leak accumulates across page navigations |
| MEDIUM | Technical debt or architectural drift. Compounds over time. Fix within current release. | Imperative Apex in `connectedCallback` without loading guard — blank flash on slow networks, double-invoke risk; Cross-component communication via DOM `querySelector` — works in dev, breaks under LWS in production; Non-keyed list iteration — full DOM re-render on every item change; hardcoded CSS colour or pixel value — fails brand compliance and SLDS2 density |
| LOW | Best practice deviation. Low immediate risk. Address in next sprint. | Missing ARIA label on icon-only button — WCAG non-compliance flagged in accessibility audit; `@track` on a primitive where it has no effect — misleads future developers about reactivity intent; Jest test uses `document.querySelector` instead of `element.shadowRoot.querySelector` — test passes incorrectly, masking shadow DOM boundary errors |
