import "server-only";

import { createHash } from "node:crypto";
import { getShopifyConfig, type ShopifyConfig } from "@/lib/env";
import { getShopifyAccessToken, resetShopifyTokenCache } from "@/lib/services/shopifyToken";

const SNIPPET_KEY = "snippets/photocard-variant-cards.liquid";
const EXPERIENCE_SNIPPET_KEY = "snippets/photocard-storefront-experience.liquid";
const INSTALL_START = "<!-- PHOTOCARD_VARIANT_CARDS_START -->";
const INSTALL_END = "<!-- PHOTOCARD_VARIANT_CARDS_END -->";
const INSTALL_BLOCK = `${INSTALL_START}\n{% render 'photocard-variant-cards' %}\n{% render 'photocard-storefront-experience' %}\n${INSTALL_END}`;
const SNIPPET_MARKER = "PHOTOCARD_VARIANT_CARDS_V1";
const EXPERIENCE_MARKER = "PHOTOCARD_STOREFRONT_EXPERIENCE_V1";

type Theme = { id: number | string; name: string; role: string };
type Asset = { key?: string; value?: string; checksum?: string | null };

export const SHOPIFY_VARIANT_CARD_SNIPPET = `{% comment %} ${SNIPPET_MARKER} {% endcomment %}
{% if request.page_type == 'product' and product.variants.size > 1 %}
  {% assign selected_variant = product.selected_or_first_available_variant %}
  <div class="pc-variant-picker" data-pc-variant-picker data-selected-id="{{ selected_variant.id }}">
    <div class="pc-variant-picker__heading"><span>{{ product.options.first }}</span><strong data-pc-selected-title>{{ selected_variant.title }}</strong></div>
    <div class="pc-variant-picker__controls"><label class="pc-variant-picker__search"><span class="visually-hidden">Search card options</span><input type="search" data-pc-option-search placeholder="Search member or card" autocomplete="off"/></label><button type="button" class="pc-variant-picker__available" data-pc-available-filter aria-pressed="false">In stock only</button><span class="pc-variant-picker__count" data-pc-visible-count></span></div>
    <div class="pc-variant-picker__grid" role="radiogroup" aria-label="{{ product.options.first | escape }}">
      {% for variant in product.variants %}
        {% assign card_image = variant.featured_media.preview_image | default: product.featured_media.preview_image %}
        <button type="button" class="pc-variant-card{% if variant.id == selected_variant.id %} is-selected{% endif %}{% unless variant.available %} is-sold-out{% endunless %}" data-pc-variant-id="{{ variant.id }}" data-pc-title="{{ variant.title | escape }}" data-pc-search="{{ variant.title | escape }}" data-pc-available="{{ variant.available }}" data-pc-price="{{ variant.price | money | escape }}" data-pc-image="{{ card_image | image_url: width: 1400 }}" data-pc-media-id="{{ variant.featured_media.id }}" role="radio" aria-checked="{% if variant.id == selected_variant.id %}true{% else %}false{% endif %}" {% unless variant.available %}disabled{% endunless %}>
          <span class="pc-variant-card__image">{% if card_image %}{{ card_image | image_url: width: 260 | image_tag: loading: 'lazy', widths: '130,195,260', alt: variant.title }}{% endif %}</span>
          <span class="pc-variant-card__name">{{ variant.title }}</span>
          <strong class="pc-variant-card__price">{{ variant.price | money }}</strong>
          {% unless variant.available %}<span class="pc-variant-card__soldout">Sold out</span>{% endunless %}
        </button>
      {% endfor %}
    </div>
  </div>
  <style>
    .pc-variant-picker{margin:1.25rem 0}.pc-variant-picker__heading{display:flex;align-items:center;gap:.65rem;margin-bottom:.75rem;font-size:.9rem}.pc-variant-picker__heading span{color:rgba(var(--color-foreground,18,18,18),.65)}.pc-variant-picker__heading strong{padding:.25rem .6rem;border-radius:.45rem;background:#5b21b6;color:#fff}.pc-variant-picker__controls{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:0 0 .85rem}.pc-variant-picker__search{min-width:12rem;flex:1}.pc-variant-picker__search input{box-sizing:border-box;width:100%;border:1px solid rgba(var(--color-foreground,18,18,18),.22);border-radius:.5rem;padding:.52rem .62rem;background:rgb(var(--color-background,255,255,255));color:inherit;font:inherit}.pc-variant-picker__available{border:1px solid #7651ca;border-radius:.5rem;padding:.52rem .62rem;background:#fff;color:#4a278f;font:inherit;font-weight:700;cursor:pointer}.pc-variant-picker__available[aria-pressed=true]{background:#5b21b6;color:#fff}.pc-variant-picker__count{color:rgba(var(--color-foreground,18,18,18),.64);font-size:.78rem;font-weight:700}.pc-variant-picker__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.7rem}.pc-variant-card{position:relative;display:flex;min-width:0;flex-direction:column;align-items:center;gap:.25rem;padding:.5rem;border:1px solid rgba(var(--color-foreground,18,18,18),.16);border-radius:.65rem;background:rgb(var(--color-background,255,255,255));color:rgb(var(--color-foreground,18,18,18));cursor:pointer;text-align:center}.pc-variant-card:hover{border-color:#7c3aed;box-shadow:0 2px 10px rgba(91,33,182,.12)}.pc-variant-card.is-selected{border:2px solid #7c3aed;padding:calc(.5rem - 1px);box-shadow:0 0 0 2px rgba(124,58,237,.12)}.pc-variant-card.is-sold-out{opacity:.48;cursor:not-allowed}.pc-variant-card__image{display:block;width:100%;aspect-ratio:1/1.18;overflow:hidden;border-radius:.35rem;background:#f5f5f5}.pc-variant-card__image img{width:100%;height:100%;object-fit:contain}.pc-variant-card__name{width:100%;overflow:hidden;text-overflow:ellipsis;font-size:.72rem;line-height:1.2;white-space:nowrap}.pc-variant-card__price{font-size:.82rem;line-height:1.2}.pc-variant-card__soldout{position:absolute;inset:auto .35rem .35rem;padding:.15rem .35rem;border-radius:.3rem;background:#111;color:#fff;font-size:.65rem}@media(max-width:749px){.pc-variant-picker__grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem}.pc-variant-picker__search{min-width:100%}}
  </style>
  <script>
    (() => {
      const init = () => document.querySelectorAll('[data-pc-variant-picker]').forEach((root) => {
        if (root.dataset.ready) return;
        root.dataset.ready = '1';
        const form = [...document.querySelectorAll('form[action*="/cart/add"]')].find((item) => item.querySelector('[name="id"]'));
        const nativePicker = document.querySelector('variant-picker fieldset.variant-option');
        const nativeComponent = nativePicker?.closest('variant-picker');
        const buttons = [...root.querySelectorAll('[data-pc-variant-id]')];
        const search = root.querySelector('[data-pc-option-search]');
        const availableFilter = root.querySelector('[data-pc-available-filter]');
        const visibleCount = root.querySelector('[data-pc-visible-count]');
        const add = form && form.querySelector('button[name="add"],button[type="submit"]');
        const filterCards = () => {
          const query = (search?.value || '').trim().toLowerCase();
          const availableOnly = root.dataset.availableOnly === 'true';
          let visible = 0;
          buttons.forEach((button) => {
            const matchesQuery = !query || (button.dataset.pcSearch || '').toLowerCase().includes(query);
            const matchesAvailability = !availableOnly || button.dataset.pcAvailable === 'true';
            button.hidden = !(matchesQuery && matchesAvailability);
            if (!button.hidden) visible += 1;
          });
          if (visibleCount) visibleCount.textContent = visible + ' cards shown';
        };
        search?.addEventListener('input', filterCards);
        availableFilter?.addEventListener('click', () => {
          const next = root.dataset.availableOnly !== 'true';
          root.dataset.availableOnly = String(next);
          availableFilter.setAttribute('aria-pressed', String(next));
          filterCards();
        });
        filterCards();
        const update = (button, notifyTheme = true) => {
          const id = button.dataset.pcVariantId;
          const nativeInput = document.querySelector('variant-picker fieldset.variant-option input[data-variant-id="' + id + '"]');
          if (notifyTheme && nativeInput) {
            nativeInput.checked = true;
            nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
            window.setTimeout(() => {
              const refreshedNativeComponent = document.querySelector('variant-picker');
              if (refreshedNativeComponent) refreshedNativeComponent.style.display = 'none';
            }, 500);
          }
          if (form) form.querySelectorAll('[name="id"]').forEach((input) => {
            input.value = id;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
          buttons.forEach((item) => {
            const active = item === button;
            item.classList.toggle('is-selected', active);
            item.setAttribute('aria-checked', active ? 'true' : 'false');
          });
          const title = root.querySelector('[data-pc-selected-title]');
          if (title) title.textContent = button.dataset.pcTitle || '';
          const price = button.dataset.pcPrice || '';
          const info = (form && form.closest('.product__info-container,[data-product-info],.product-info')) || document.querySelector('.product__info-container,[data-product-info],.product-info');
          const priceNode = info && info.querySelector('.price-item--regular,[data-product-price],.product__price .money');
          if (priceNode && price) priceNode.textContent = price;
          const imageUrl = button.dataset.pcImage;
          if (imageUrl) {
            const gallery = document.querySelector('media-gallery');
            const mainImage = gallery?.querySelector('slideshow-slide[aria-hidden="false"] .product-media__image')
              || gallery?.querySelector('slideshow-slide .product-media__image')
              || document.querySelector('.product-media__image,.product__media img,.product-gallery img,[data-product-media] img');
            if (mainImage) {
              mainImage.removeAttribute('srcset');
              mainImage.src = imageUrl;
              mainImage.setAttribute('data-pc-variant-image', id);
            }
          }
          if (add) add.disabled = button.disabled;
        };
        buttons.forEach((button) => button.addEventListener('click', () => update(button)));
        if (nativeComponent && nativeComponent.parentElement) {
          nativeComponent.insertAdjacentElement('afterend', root);
          nativeComponent.style.display = 'none';
        } else {
          const anchor = form && form.querySelector('.product-form__buttons,button[name="add"],button[type="submit"]');
          if (anchor) {
            const placement = anchor.closest('.product-form__buttons') || anchor;
            placement.parentElement.insertBefore(root, placement);
            form.querySelectorAll('variant-selects,variant-radios,[data-variant-picker]').forEach((picker) => {
              if (!picker.contains(root)) picker.style.display = 'none';
            });
          } else {
            const info = document.querySelector('.product__info-container,[data-product-info],.product-info');
            if (info) info.append(root);
          }
        }
        const selected = buttons.find((button) => button.dataset.pcVariantId === root.dataset.selectedId && !button.disabled) || buttons.find((button) => !button.disabled);
        if (selected) {
          update(selected);
        }
      });
      document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
      document.addEventListener('shopify:section:load', init);
    })();
  </script>
{% endif %}`;

export const SHOPIFY_STOREFRONT_EXPERIENCE_SNIPPET = `{% comment %} ${EXPERIENCE_MARKER} {% endcomment %}
<style>
  :root{--pc-ink:#191127;--pc-violet:#6334c7;--pc-violet-dark:#3f217f;--pc-mist:#f7f4ff;--pc-line:#e5ddf5}
  body{background:linear-gradient(180deg,#fff 0,#fbfaff 40rem,#fff 70rem);color:var(--pc-ink)}
  a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid rgba(99,52,199,.42);outline-offset:3px}
  .pc-storefront-hero{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(18rem,.85fr);gap:2rem;align-items:center;max-width:78rem;margin:1.4rem auto 2.4rem;padding:clamp(1.5rem,4vw,3.5rem);border:1px solid var(--pc-line);border-radius:1.5rem;background:radial-gradient(circle at 85% 15%,#e8dcff 0,transparent 32%),linear-gradient(135deg,#251044,#6334c7);color:#fff;box-shadow:0 18px 50px rgba(63,33,127,.2)}
  .pc-storefront-hero__eyebrow{margin:0 0 .8rem;font-size:.73rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#d9caff}.pc-storefront-hero h1{max-width:13ch;margin:0;font-size:clamp(2rem,5vw,4rem);line-height:1.03;letter-spacing:-.045em}.pc-storefront-hero p{max-width:38rem;margin:1rem 0 0;font-size:1rem;line-height:1.65;color:#f0ebff}.pc-storefront-hero__points{display:grid;gap:.7rem;margin:0;padding:1.15rem;list-style:none;border:1px solid rgba(255,255,255,.24);border-radius:1rem;background:rgba(255,255,255,.11);backdrop-filter:blur(10px)}.pc-storefront-hero__points li{display:flex;gap:.55rem;align-items:center;font-size:.92rem}.pc-storefront-hero__points li::before{content:'✓';display:grid;width:1.35rem;height:1.35rem;place-items:center;border-radius:50%;background:#d9caff;color:#32166d;font-weight:900}
  .pc-collection-tools{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;max-width:78rem;margin:0 auto 1.25rem;padding:1rem 1.1rem;border:1px solid var(--pc-line);border-radius:1rem;background:#fff;box-shadow:0 8px 25px rgba(32,18,66,.06)}.pc-collection-tools__label{font-weight:800}.pc-collection-tools input{min-width:min(100%,18rem);flex:1;border:1px solid #cfc4e6;border-radius:.7rem;padding:.7rem .85rem;background:var(--pc-mist);font:inherit;color:inherit}.pc-collection-tools__count{color:#625778;font-size:.88rem}
  .pc-product-guide{display:flex;flex-wrap:wrap;gap:.6rem;margin:1.1rem 0;padding:0;list-style:none}.pc-product-guide li{display:flex;align-items:center;gap:.42rem;padding:.48rem .66rem;border:1px solid var(--pc-line);border-radius:999px;background:var(--pc-mist);font-size:.78rem;font-weight:700;color:#4b3974}.pc-product-guide li::before{display:grid;place-items:center;width:1.25rem;height:1.25rem;border-radius:50%;background:var(--pc-violet);color:#fff;font-size:.7rem}.pc-product-guide li:nth-child(1)::before{content:'1'}.pc-product-guide li:nth-child(2)::before{content:'2'}.pc-product-guide li:nth-child(3)::before{content:'3'}
  .pc-variant-picker{padding:1.05rem;border:1px solid var(--pc-line);border-radius:1rem;background:linear-gradient(145deg,#fff,#faf8ff);box-shadow:0 10px 26px rgba(47,25,96,.07)}.pc-variant-picker__heading{margin-bottom:1rem}.pc-variant-picker__heading span{font-weight:700;color:#66577f}.pc-variant-picker__heading strong{background:var(--pc-violet)}.pc-variant-card{transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}.pc-variant-card:hover{transform:translateY(-2px)}.pc-variant-card__name{font-weight:700}.pc-variant-card__price{color:var(--pc-violet-dark)}
  @media(max-width:749px){.pc-storefront-hero{grid-template-columns:1fr;margin:1rem;border-radius:1.1rem}.pc-storefront-hero h1{font-size:2.25rem}.pc-collection-tools{margin:0 1rem 1rem}.pc-variant-picker{padding:.8rem}.pc-product-guide{gap:.4rem}.pc-product-guide li{font-size:.72rem}}
</style>
{% if request.page_type == 'index' %}
  <section class="pc-storefront-hero" data-pc-storefront-hero aria-labelledby="pc-storefront-hero-title">
    <div><p class="pc-storefront-hero__eyebrow">K-pop photocard collection</p><h1 id="pc-storefront-hero-title">Find the card you want.</h1><p>Browse clear card photos, compare each option price, and choose the exact photocard before adding it to your cart.</p></div>
    <ul class="pc-storefront-hero__points"><li>Option-by-option card photos</li><li>Clear price for every card</li><li>Simple, focused checkout flow</li></ul>
  </section>
{% endif %}
{% if request.page_type == 'collection' %}
  <div class="pc-collection-tools" data-pc-collection-tools><label class="pc-collection-tools__label" for="pc-collection-search">Find a card</label><input id="pc-collection-search" type="search" placeholder="Search artist, album, or member" autocomplete="off"/><span class="pc-collection-tools__count" data-pc-collection-count></span></div>
{% endif %}
{% if request.page_type == 'product' %}
  <ul class="pc-product-guide" data-pc-product-guide aria-label="How to buy"><li>Choose a card</li><li>Check its price</li><li>Add to cart</li></ul>
{% endif %}
<script>
  (() => {
    const normalizeDuplicateTitles = () => document.querySelectorAll('main h1,main h2,main h3').forEach((node) => {
      const text = node.textContent?.trim() || '';
      if (text.length < 8 || text.length % 2) return;
      const half = text.slice(0, text.length / 2).trim();
      if (half && half === text.slice(text.length / 2).trim()) node.textContent = half;
    });
    const move = (selector, targetSelector) => {
      const node = document.querySelector(selector); const target = document.querySelector(targetSelector);
      if (node && target && !target.contains(node)) target.prepend(node);
    };
    const setupCollectionSearch = () => {
      const tools = document.querySelector('[data-pc-collection-tools]');
      const input = tools?.querySelector('input'); const count = tools?.querySelector('[data-pc-collection-count]');
      if (!tools || !input || !count || tools.dataset.ready) return;
      tools.dataset.ready = '1';
      const cards = () => [...document.querySelectorAll('main product-card,main .resource-card')];
      const filter = () => { const query = input.value.trim().toLowerCase(); const items = cards(); let visible = 0; items.forEach((item) => { const matched = !query || (item.textContent || '').toLowerCase().includes(query); item.style.display = matched ? '' : 'none'; if (matched) visible += 1; }); count.textContent = query ? visible + ' matching cards' : items.length + ' cards'; };
      input.addEventListener('input', filter); filter();
    };
    const init = () => { move('[data-pc-storefront-hero]', 'main'); move('[data-pc-collection-tools]', 'main'); const guide = document.querySelector('[data-pc-product-guide]'); const picker = document.querySelector('[data-pc-variant-picker]'); if (guide && picker && !picker.contains(guide)) picker.parentElement?.insertBefore(guide, picker); normalizeDuplicateTitles(); setupCollectionSearch(); };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
    document.addEventListener('shopify:section:load', init);
  })();
</script>`;

function checksum(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function injectVariantCardRender(layout: string) {
  if (layout.includes(INSTALL_START)) return layout;
  const bodyEnd = layout.toLowerCase().lastIndexOf("</body>");
  if (bodyEnd < 0) throw new Error("활성 Shopify 테마의 theme.liquid에서 </body>를 찾지 못해 변경하지 않았습니다.");
  return `${layout.slice(0, bodyEnd)}${INSTALL_BLOCK}\n${layout.slice(bodyEnd)}`;
}

async function request<T>(config: ShopifyConfig, path: string, init?: RequestInit, refreshed = false): Promise<T> {
  const response = await fetch(`https://${config.storeDomain}/admin/api/${config.apiVersion}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": await getShopifyAccessToken(config), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(25_000),
  });
  if (!refreshed && !config.accessToken && (response.status === 401 || response.status === 403)) {
    resetShopifyTokenCache();
    return request<T>(config, path, init, true);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const permission = response.status === 401 || response.status === 403
      ? " Shopify 앱에 read_themes와 write_themes 권한을 추가한 뒤 권한을 갱신해 주세요."
      : "";
    throw new Error(`Shopify 테마 요청 실패 (${response.status}).${permission}`);
  }
  return body as T;
}

async function mainTheme(config: ShopifyConfig) {
  const body = await request<{ themes?: Theme[] }>(config, "/themes.json");
  const theme = body.themes?.find((item) => item.role === "main");
  if (!theme) throw new Error("Shopify에서 현재 공개 중인 테마를 찾지 못했습니다.");
  return theme;
}

async function getAsset(config: ShopifyConfig, themeId: string, key: string, optional = false) {
  try {
    const query = new URLSearchParams({ "asset[key]": key });
    return (await request<{ asset?: Asset }>(config, `/themes/${themeId}/assets.json?${query}`)).asset ?? null;
  } catch (error) {
    if (optional && error instanceof Error && error.message.includes("(404)")) return null;
    throw error;
  }
}

async function putAsset(config: ShopifyConfig, themeId: string, key: string, value: string) {
  return request<{ asset?: Asset }>(config, `/themes/${themeId}/assets.json`, {
    method: "PUT",
    body: JSON.stringify({ asset: { key, value } }),
  });
}

export async function getShopifyVariantCardThemeStatus() {
  const config = getShopifyConfig();
  const theme = await mainTheme(config);
  const layout = await getAsset(config, String(theme.id), "layout/theme.liquid");
  const snippet = await getAsset(config, String(theme.id), SNIPPET_KEY, true);
  const experience = await getAsset(config, String(theme.id), EXPERIENCE_SNIPPET_KEY, true);
  const layoutValue = layout?.value ?? "";
  const snippetValue = snippet?.value ?? "";
  const experienceValue = experience?.value ?? "";
  return {
    themeId: String(theme.id),
    themeName: theme.name,
    installed: layoutValue.includes(INSTALL_START) && snippetValue.includes(SNIPPET_MARKER) && experienceValue.includes(EXPERIENCE_MARKER),
    partial: !layoutValue.includes(INSTALL_START) || !snippetValue.includes(SNIPPET_MARKER) || !experienceValue.includes(EXPERIENCE_MARKER),
  };
}

export async function installShopifyVariantCardTheme() {
  const config = getShopifyConfig();
  const theme = await mainTheme(config);
  const themeId = String(theme.id);
  const layout = await getAsset(config, themeId, "layout/theme.liquid");
  if (!layout?.value) throw new Error("활성 Shopify 테마의 theme.liquid 내용을 읽지 못해 변경하지 않았습니다.");
  const existingSnippet = await getAsset(config, themeId, SNIPPET_KEY, true);
  if (existingSnippet?.value && !existingSnippet.value.includes(SNIPPET_MARKER)) {
    throw new Error(`${SNIPPET_KEY} 파일이 이미 다른 용도로 존재해 덮어쓰지 않았습니다.`);
  }
  const existingExperience = await getAsset(config, themeId, EXPERIENCE_SNIPPET_KEY, true);
  if (existingExperience?.value && !existingExperience.value.includes(EXPERIENCE_MARKER)) {
    throw new Error(`${EXPERIENCE_SNIPPET_KEY} 파일이 이미 다른 용도로 존재해 덮어쓰지 않았습니다.`);
  }
  const nextLayout = injectVariantCardRender(layout.value);
  await putAsset(config, themeId, SNIPPET_KEY, SHOPIFY_VARIANT_CARD_SNIPPET);
  await putAsset(config, themeId, EXPERIENCE_SNIPPET_KEY, SHOPIFY_STOREFRONT_EXPERIENCE_SNIPPET);
  if (nextLayout !== layout.value) await putAsset(config, themeId, "layout/theme.liquid", nextLayout);
  const verified = await getShopifyVariantCardThemeStatus();
  if (!verified.installed || verified.themeId !== themeId) throw new Error("Shopify 테마 저장 후 설치 상태를 확인하지 못했습니다.");
  return { ...verified, layoutBefore: checksum(layout.value), layoutAfter: checksum(nextLayout) };
}
