const fs=require('fs');
const read=key=>fs.readFileSync('.codex-tmp/price-theme-'+key.replaceAll('/','-'),'utf8');
const write=(key,s)=>{const path='shopify-theme/'+key;fs.mkdirSync(require('path').dirname(path),{recursive:true});fs.writeFileSync(path,s);};
let key='snippets/photocard-variant-cards.liquid',s=read(key);
s=s.replace('{% assign card_image = variant.featured_media.preview_image | default: product.featured_media.preview_image %}',`{% assign card_image = variant.featured_media.preview_image | default: product.featured_media.preview_image %}
        {% assign price_review_required = variant.metafields.order_manager.price_review_required.value %}
        {% assign card_available = variant.available %}
        {% assign card_price = variant.price | money %}
        {% if price_review_required %}{% assign card_available = false %}{% assign card_price = 'Price confirmation pending' %}{% endif %}`);
s=s.replaceAll('unless variant.available','unless card_available').replace('{{ variant.price | money | escape }}','{{ card_price | escape }}').replace('{{ variant.price | money }}','{{ card_price }}').replace('>Sold out</span>','>{% if price_review_required %}Price pending{% else %}Sold out{% endif %}</span>');
write(key,s);
key='snippets/price.liquid';s=read(key);
s=s.replace('  assign price = selected_variant.price',`  assign price_review_required = selected_variant.metafields.order_manager.price_review_required.value
  if template.name != 'product' and price_review_required
    for candidate in product_resource.variants
      unless candidate.metafields.order_manager.price_review_required.value
        assign selected_variant = candidate
        assign price_review_required = false
        break
      endunless
    endfor
  endif
  assign price = selected_variant.price`);
s=s.replace('    assign price_min = product_resource.price_min\n    assign price_max = product_resource.price_max',`    assign price_min = null
    assign price_max = null
    for candidate in product_resource.variants
      unless candidate.metafields.order_manager.price_review_required.value
        if price_min == null or candidate.price < price_min
          assign price_min = candidate.price
        endif
        if price_max == null or candidate.price > price_max
          assign price_max = candidate.price
        endif
      endunless
    endfor`);
s=s.replace('<div ref="priceContainer">','<div ref="priceContainer">\n  {% if price_review_required %}\n    <span class="price price--pending">Price confirmation pending</span>\n  {% else %}');
s=s.replace('\n</div>\n{%- if has_volume_pricing -%}','\n  {% endif %}\n</div>\n{%- if has_volume_pricing and price_review_required != true -%}');
write(key,s);
key='blocks/buy-buttons.liquid';s=read(key);
s=s.replace('    if variant.available',`    if variant.metafields.order_manager.price_review_required.value
      assign can_add_to_cart = false
      assign add_to_cart_text = 'Price confirmation pending'
    elsif variant.available`);
write(key,s);
console.log('Prepared 3 price-hold theme files');
