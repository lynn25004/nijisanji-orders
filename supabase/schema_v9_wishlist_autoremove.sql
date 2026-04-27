-- v9: 訂單掃到的商品如果在 wishlist，自動軟刪除
-- 觸發時機：任何 cron 把新 product 寫入 products 表時
-- 比對欄位：products.shop_product_code = wishlist.shop_product_code

create or replace function auto_remove_from_wishlist()
returns trigger as $$
begin
  if NEW.shop_product_code is not null then
    update wishlist
       set ordered_at = now()
     where ordered_at is null
       and shop_product_code = NEW.shop_product_code;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_wishlist_autoremove on products;
create trigger trg_wishlist_autoremove
after insert on products
for each row execute function auto_remove_from_wishlist();
