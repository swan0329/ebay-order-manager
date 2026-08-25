import "server-only";

import { createHash } from "node:crypto";
import { getShopifyConfig, type ShopifyConfig } from "@/lib/env";
import { getShopifyAccessToken, resetShopifyTokenCache } from "@/lib/services/shopifyToken";

const SNIPPET_KEY = "snippets/photocard-variant-cards.liquid";
const INSTALL_START = "<!-- PHOTOCARD_VARIANT_CARDS_START -->";
const INSTALL_END = "<!-- PHOTOCARD_VARIANT_CARDS_END -->";
const INSTALL_BLOCK = `${INSTALL_START}\n{% render 'photocard-variant-cards' %}\n${INSTALL_END}`;
const SNIPPET_MARKER = "PHOTOCARD_VARIANT_CARDS_V1";

type Theme = { id: number | string; name: string; role: string };
type Asset = { key?: string; value?: string; checksum?: string | null };

export const SHOPIFY_VARIANT_CARD_SNIPPET = `{% comment %} ${SNIPPET_MARKER} {% endcomment %}
{% if request.page_type == 'product' and product.product_type == 'Photocard' and product.variants.size > 1 %}
  {% assign selected_variant = product.selected_or_first_available_variant %}
  <div class="pc-variant-picker" data-pc-variant-picker data-selected-id="{{ selected_variant.id }}">
    <div class="pc-variant-picker__heading"><span>{{ product.options.first }}</span><strong data-pc-selected-title>{{ selected_variant.title }}</strong></div>
    <div class="pc-variant-picker__grid" role="radiogroup" aria-label="{{ product.options.first | escape }}">
      {% for variant in product.variants %}
        {% assign card_image = variant.featured_media.preview_image | default: product.featured_media.preview_image %}
        <button type="button" class="pc-variant-card{% if variant.id == selected_variant.id %} is-selected{% endif %}{% unless variant.available %} is-sold-out{% endunless %}" data-pc-variant-id="{{ variant.id }}" data-pc-title="{{ variant.title | escape }}" data-pc-price="{{ variant.price | money | escape }}" data-pc-image="{{ card_image | image_url: width: 1400 }}" data-pc-media-id="{{ variant.featured_media.id }}" role="radio" aria-checked="{% if variant.id == selected_variant.id %}true{% else %}false{% endif %}" {% unless variant.available %}disabled{% endunless %}>
          <span class="pc-variant-card__image">{% if card_image %}{{ card_image | image_url: width: 260 | image_tag: loading: 'lazy', widths: '130,195,260', alt: variant.title }}{% endif %}</span>
          <span class="pc-variant-card__name">{{ variant.title }}</span>
          <strong class="pc-variant-card__price">{{ variant.price | money }}</strong>
          {% unless variant.available %}<span class="pc-variant-card__soldout">Sold out</span>{% endunless %}
        </button>
      {% endfor %}
    </div>
  </div>
  <style>
    .pc-variant-picker{margin:1.25rem 0}.pc-variant-picker__heading{display:flex;align-items:center;gap:.65rem;margin-bottom:.75rem;font-size:.9rem}.pc-variant-picker__heading span{color:rgba(var(--color-foreground,18,18,18),.65)}.pc-variant-picker__heading strong{padding:.25rem .6rem;border-radius:.45rem;background:#5b21b6;color:#fff}.pc-variant-picker__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.7rem}.pc-variant-card{position:relative;display:flex;min-width:0;flex-direction:column;align-items:center;gap:.25rem;padding:.5rem;border:1px solid rgba(var(--color-foreground,18,18,18),.16);border-radius:.65rem;background:rgb(var(--color-background,255,255,255));color:rgb(var(--color-foreground,18,18,18));cursor:pointer;text-align:center}.pc-variant-card:hover{border-color:#7c3aed;box-shadow:0 2px 10px rgba(91,33,182,.12)}.pc-variant-card.is-selected{border:2px solid #7c3aed;padding:calc(.5rem - 1px);box-shadow:0 0 0 2px rgba(124,58,237,.12)}.pc-variant-card.is-sold-out{opacity:.48;cursor:not-allowed}.pc-variant-card__image{display:block;width:100%;aspect-ratio:1/1.18;overflow:hidden;border-radius:.35rem;background:#f5f5f5}.pc-variant-card__image img{width:100%;height:100%;object-fit:contain}.pc-variant-card__name{width:100%;overflow:hidden;text-overflow:ellipsis;font-size:.72rem;line-height:1.2;white-space:nowrap}.pc-variant-card__price{font-size:.82rem;line-height:1.2}.pc-variant-card__soldout{position:absolute;inset:auto .35rem .35rem;padding:.15rem .35rem;border-radius:.3rem;background:#111;color:#fff;font-size:.65rem}@media(max-width:749px){.pc-variant-picker__grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem}}
  </style>
  <script>
    (()=>{const init=()=>document.querySelectorAll('[data-pc-variant-picker]').forEach(root=>{if(root.dataset.ready)return;const form=[...document.querySelectorAll('form[action*="/cart/add"]')].find(item=>item.querySelector('[name="id"]'));if(!form)return;root.dataset.ready='1';const buttons=[...root.querySelectorAll('[data-pc-variant-id]')];const add=form.querySelector('button[name="add"],button[type="submit"]');const update=(button)=>{const id=button.dataset.pcVariantId;document.querySelectorAll('form[action*="/cart/add"] [name="id"]').forEach(input=>{input.value=id;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))});buttons.forEach(item=>{const active=item===button;item.classList.toggle('is-selected',active);item.setAttribute('aria-checked',active?'true':'false')});const title=root.querySelector('[data-pc-selected-title]');if(title)title.textContent=button.dataset.pcTitle||'';const price=button.dataset.pcPrice||'';const info=form.closest('.product__info-container,[data-product-info],.product-info')||form.parentElement;const priceNode=info&&info.querySelector('.price-item--regular,[data-product-price],.product__price .money');if(priceNode&&price)priceNode.textContent=price;const mediaId=button.dataset.pcMediaId;const mediaTrigger=mediaId&&document.querySelector('[data-target*="'+mediaId+'"],button[data-media-id*="'+mediaId+'"],[data-media-id*="'+mediaId+'"] button');if(mediaTrigger)mediaTrigger.click();else{const mainImage=document.querySelector('.product__media img,.product-gallery img,[data-product-media] img');if(mainImage&&button.dataset.pcImage){mainImage.removeAttribute('srcset');mainImage.src=button.dataset.pcImage}}if(add)add.disabled=button.disabled;const url=new URL(location.href);url.searchParams.set('variant',id);history.replaceState({},'',url)};buttons.forEach(button=>button.addEventListener('click',()=>update(button)));const anchor=form.querySelector('.product-form__buttons,button[name="add"],button[type="submit"]');if(anchor){const placement=anchor.closest('.product-form__buttons')||anchor;placement.parentElement.insertBefore(root,placement)}else form.prepend(root);form.querySelectorAll('variant-selects,variant-radios,[data-variant-picker]').forEach(picker=>{if(!picker.contains(root))picker.style.display='none'});const selected=buttons.find(button=>button.dataset.pcVariantId===root.dataset.selectedId&&!button.disabled)||buttons.find(button=>!button.disabled);if(selected)update(selected)})};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();document.addEventListener('shopify:section:load',init)})();
  </script>
{% endif %}`;

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
  const layoutValue = layout?.value ?? "";
  const snippetValue = snippet?.value ?? "";
  return {
    themeId: String(theme.id),
    themeName: theme.name,
    installed: layoutValue.includes(INSTALL_START) && snippetValue.includes(SNIPPET_MARKER),
    partial: layoutValue.includes(INSTALL_START) !== snippetValue.includes(SNIPPET_MARKER),
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
  const nextLayout = injectVariantCardRender(layout.value);
  await putAsset(config, themeId, SNIPPET_KEY, SHOPIFY_VARIANT_CARD_SNIPPET);
  if (nextLayout !== layout.value) await putAsset(config, themeId, "layout/theme.liquid", nextLayout);
  const verified = await getShopifyVariantCardThemeStatus();
  if (!verified.installed || verified.themeId !== themeId) throw new Error("Shopify 테마 저장 후 설치 상태를 확인하지 못했습니다.");
  return { ...verified, layoutBefore: checksum(layout.value), layoutAfter: checksum(nextLayout) };
}
