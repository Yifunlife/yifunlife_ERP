-- Confirmed catalogue corrections from the 2026-11-06 issue review.
-- Upload the four immutable image objects in the adjacent manifest before applying.
-- Original images, quotation snapshots, prices, types and pairing quantities are retained.

-- Y10555 空乘柜子
UPDATE product_classifications SET level_1='职业体验 / Career Experience', level_3='航空区', updated_at=datetime('now') WHERE product_id='junior-Y10555' AND level_1='职业体验 / Career Experience' AND level_3='工地区';
UPDATE product_overrides SET major_category='职业体验 / Career Experience', category_2='航空区', updated_at=datetime('now') WHERE product_id='junior-Y10555' AND major_category IS NULL AND category_2 IS '工地区';
UPDATE catalog_products SET category='航空区' WHERE id='junior-Y10555' AND category='警察、工地设备';
-- Y10753 CT机
UPDATE product_classifications SET level_1='动物世界 / Animal World', level_3='宠物医院区', updated_at=datetime('now') WHERE product_id='junior-Y10753' AND level_1='农牧生活 / Agro-pastoral Life' AND level_3='牧场区';
UPDATE product_overrides SET major_category='动物世界 / Animal World', category_2='宠物医院区', updated_at=datetime('now') WHERE product_id='junior-Y10753' AND major_category IS NULL AND category_2 IS '牧场区';
UPDATE catalog_products SET category='宠物医院区' WHERE id='junior-Y10753' AND category='牧场区';
-- Y10754 手术台（2个为一对）
UPDATE product_classifications SET level_1='动物世界 / Animal World', level_3='宠物医院区', updated_at=datetime('now') WHERE product_id='junior-Y10754' AND level_1='农牧生活 / Agro-pastoral Life' AND level_3='牧场区';
UPDATE product_overrides SET major_category='动物世界 / Animal World', category_2='宠物医院区', updated_at=datetime('now') WHERE product_id='junior-Y10754' AND major_category IS NULL AND category_2 IS '牧场区';
UPDATE catalog_products SET category='宠物医院区' WHERE id='junior-Y10754' AND category='牧场区';
-- Y10755 置物架
UPDATE product_classifications SET level_1='动物世界 / Animal World', level_3='宠物医院区', updated_at=datetime('now') WHERE product_id='junior-Y10755' AND level_1='农牧生活 / Agro-pastoral Life' AND level_3='牧场区';
UPDATE product_overrides SET major_category='动物世界 / Animal World', category_2='宠物医院区', updated_at=datetime('now') WHERE product_id='junior-Y10755' AND major_category IS NULL AND category_2 IS '牧场区';
UPDATE catalog_products SET category='宠物医院区' WHERE id='junior-Y10755' AND category='牧场区';
-- Y10341 花车
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='花店区', updated_at=datetime('now') WHERE product_id='junior-Y10341' AND level_1='生活场景 / Lifestyle Scene' AND level_3='超市区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='花店区', updated_at=datetime('now') WHERE product_id='junior-Y10341' AND major_category IS NULL AND category_2 IS '超市区';
UPDATE catalog_products SET category='花店区' WHERE id='junior-Y10341' AND category='超市区模拟设备';
-- Y10343 花车装饰花朵柜
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='花店区', updated_at=datetime('now') WHERE product_id='junior-Y10343' AND level_1='生活场景 / Lifestyle Scene' AND level_3='超市区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='花店区', updated_at=datetime('now') WHERE product_id='junior-Y10343' AND major_category IS NULL AND category_2 IS '超市区';
UPDATE catalog_products SET category='花店区' WHERE id='junior-Y10343' AND category='超市区模拟设备';
-- Y10344 花车架子
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='花店区', updated_at=datetime('now') WHERE product_id='junior-Y10344' AND level_1='生活场景 / Lifestyle Scene' AND level_3='超市区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='花店区', updated_at=datetime('now') WHERE product_id='junior-Y10344' AND major_category IS NULL AND category_2 IS '超市区';
UPDATE catalog_products SET category='花店区' WHERE id='junior-Y10344' AND category='超市区模拟设备';
-- Y10345 花车牌子
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='花店区', updated_at=datetime('now') WHERE product_id='junior-Y10345' AND level_1='生活场景 / Lifestyle Scene' AND level_3='超市区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='花店区', updated_at=datetime('now') WHERE product_id='junior-Y10345' AND major_category IS NULL AND category_2 IS '超市区';
UPDATE catalog_products SET category='花店区' WHERE id='junior-Y10345' AND category='超市区模拟设备';
-- Y10918 奶茶配料台
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10918' AND level_1='生活场景 / Lifestyle Scene' AND level_3='甜品区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10918' AND major_category IS NULL AND category_2 IS '甜品区';
UPDATE catalog_products SET category='奶茶区' WHERE id='junior-Y10918' AND category='甜品、面包房、寿司区模拟设备';
-- Y10919 奶茶装饰台
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10919' AND level_1='生活场景 / Lifestyle Scene' AND level_3='甜品区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10919' AND major_category IS NULL AND category_2 IS '甜品区';
UPDATE catalog_products SET category='奶茶区' WHERE id='junior-Y10919' AND category='甜品、面包房、寿司区模拟设备';
-- Y10920 奶茶打卡台
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10920' AND level_1='生活场景 / Lifestyle Scene' AND level_3='甜品区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10920' AND major_category IS NULL AND category_2 IS '甜品区';
UPDATE catalog_products SET category='奶茶区' WHERE id='junior-Y10920' AND category='甜品、面包房、寿司区模拟设备';
-- Y10921 奶茶前台
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10921' AND level_1='生活场景 / Lifestyle Scene' AND level_3='甜品区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10921' AND major_category IS NULL AND category_2 IS '甜品区';
UPDATE catalog_products SET category='奶茶区' WHERE id='junior-Y10921' AND category='甜品、面包房、寿司区模拟设备';
-- Y10923 奶茶长椅
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10923' AND level_1='生活场景 / Lifestyle Scene' AND level_3='甜品区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10923' AND major_category IS NULL AND category_2 IS '甜品区';
UPDATE catalog_products SET category='奶茶区' WHERE id='junior-Y10923' AND category='甜品、面包房、寿司区模拟设备';
-- Y10924 泡泡奶茶组合
UPDATE product_classifications SET level_1='生活场景 / Lifestyle Scene', level_3='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10924' AND level_1='生活场景 / Lifestyle Scene' AND level_3='甜品区';
UPDATE product_overrides SET major_category='生活场景 / Lifestyle Scene', category_2='奶茶区', updated_at=datetime('now') WHERE product_id='junior-Y10924' AND major_category IS NULL AND category_2 IS NULL;
UPDATE catalog_products SET category='奶茶区' WHERE id='junior-Y10924' AND category='甜品区';
-- Y10440 verified source image
UPDATE catalog_products SET image_key='catalog/corrections-20261106/Y10440-d716d73223949a27.png' WHERE id='junior-Y10440' AND image_key='products/latest-equipment-20260824/junior-Y10440.png';
-- Y10447 verified source image
UPDATE catalog_products SET image_key='catalog/corrections-20261106/Y10447-50c6469ab955bfd5.png' WHERE id='junior-Y10447' AND image_key='products/latest-equipment-20260824/junior-Y10447.png';
-- Y10448 verified source image
UPDATE catalog_products SET image_key='catalog/corrections-20261106/Y10448-61cde47b65f30abc.png' WHERE id='junior-Y10448' AND image_key='products/latest-equipment-20260824/junior-Y10448.png';
-- Y10637 verified source image
UPDATE catalog_products SET image_key='catalog/corrections-20261106/Y10637-2ad23ed604e90a5e.png' WHERE id='junior-Y10637' AND image_key='products/latest-equipment-20260824/junior-Y10637.png';
