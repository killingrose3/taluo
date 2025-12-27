-- ============================================
-- Nyx Studio - Supabase Database Schema
-- 塔罗工作室管理系统 数据库结构
-- ============================================
-- 执行顺序: 请按照文件中的顺序依次执行每个部分
-- ============================================

-- ============================================
-- 1. 创建枚举类型
-- ============================================

-- 用户角色枚举
CREATE TYPE user_role AS ENUM ('manager', 'receptionist');

-- 订单类型枚举
CREATE TYPE order_type AS ENUM (
  'normal',         -- 正常单
  'gift',           -- 礼物单
  'monthly',        -- 月卡单
  'prepaid',        -- 预存单
  'deduct_prepaid', -- 使用预存
  'bonus'           -- 奖金/支出
);

-- 奖金类型枚举
CREATE TYPE bonus_type AS ENUM (
  'tea',            -- 奶茶
  'psychology',     -- 心理委员补助
  'recruitment',    -- 招新提成
  'weeklyReward'    -- 周任务奖励
);

-- ============================================
-- 2. 创建用户表 (users)
-- ============================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 基本信息
  name VARCHAR(100) NOT NULL UNIQUE,
  emoji VARCHAR(20) DEFAULT '👤',
  password VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'receptionist',
  
  -- 员工状态
  is_intern BOOLEAN DEFAULT true,          -- 是否实习 (实习底薪20元, 正式40元)
  is_deleted BOOLEAN DEFAULT false,        -- 软删除标记 (注销员工)
  
  -- 提成设置
  commission_rate DECIMAL(5, 2) DEFAULT 5.00,   -- 基础提成比例 (默认5%)
  commission_expiry TIMESTAMPTZ,                 -- 临时提成有效期
  
  -- 结算相关
  last_settlement_date TIMESTAMPTZ,        -- 上次结算时间
  backup_settlement_date TIMESTAMPTZ,      -- 备份结算时间 (用于撤销)
  
  -- 时间戳
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 创建默认管理员账号
INSERT INTO users (name, emoji, password, role, is_intern)
VALUES ('管理者', '🐯', '123', 'manager', false);

-- ============================================
-- 3. 创建订单表 (orders)
-- ============================================

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  
  -- 关联信息
  receptionist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  boss_name VARCHAR(100) NOT NULL,         -- 老板(客户)名称
  diviner_id VARCHAR(100),                 -- 占卜师标识 (字符串, 非外键)
  
  -- 订单信息
  type order_type NOT NULL,
  amount DECIMAL(10, 2) DEFAULT 0,         -- 订单金额
  question_content TEXT,                    -- 问题描述
  bonus_type bonus_type,                    -- 奖金类型 (仅 type='bonus' 时使用)
  
  -- 审核状态
  approved BOOLEAN DEFAULT false,          -- true:已通过, false:待审核
  
  -- 时间信息
  date DATE NOT NULL,                      -- 业务归属日期 (用于按日统计)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 约束
  CONSTRAINT valid_amount CHECK (amount >= 0)
);

-- 创建索引
CREATE INDEX idx_orders_receptionist ON orders(receptionist_id);
CREATE INDEX idx_orders_boss_name ON orders(boss_name);
CREATE INDEX idx_orders_date ON orders(date);
CREATE INDEX idx_orders_type ON orders(type);
CREATE INDEX idx_orders_approved ON orders(approved);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- ============================================
-- 4. 创建惩罚表 (penalties)
-- ============================================

CREATE TABLE penalties (
  id BIGSERIAL PRIMARY KEY,
  
  receptionist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,          -- 罚款金额
  reason VARCHAR(500) NOT NULL,            -- 罚款原因
  
  date DATE NOT NULL,                      -- 罚款归属日期
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_penalties_receptionist ON penalties(receptionist_id);
CREATE INDEX idx_penalties_date ON penalties(date);

-- ============================================
-- 5. 创建公告表 (announcements)
-- ============================================

CREATE TABLE announcements (
  id BIGSERIAL PRIMARY KEY,
  
  content TEXT NOT NULL,                   -- 公告内容
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建已读公告记录表
CREATE TABLE read_announcements (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, announcement_id)
);

-- ============================================
-- 6. 创建周结算记录表 (weekly_settlements)
-- ============================================

CREATE TABLE weekly_settlements (
  id BIGSERIAL PRIMARY KEY,
  
  receptionist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,                -- 周开始日期 (周一)
  
  -- 结算金额明细
  base_salary DECIMAL(10, 2) DEFAULT 0,    -- 底薪
  order_commission DECIMAL(10, 2) DEFAULT 0, -- 订单提成
  bonus_amount DECIMAL(10, 2) DEFAULT 0,   -- 奖金总额
  penalty_amount DECIMAL(10, 2) DEFAULT 0, -- 惩罚总额
  total_salary DECIMAL(10, 2) DEFAULT 0,   -- 应发工资
  
  -- 任务完成情况
  monthly_count INT DEFAULT 0,             -- 月卡单数量
  task_completed BOOLEAN DEFAULT false,    -- 是否完成周任务(月卡>=3)
  
  -- 状态
  is_settled BOOLEAN DEFAULT false,        -- 是否已结算
  settled_at TIMESTAMPTZ,                  -- 结算时间
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(receptionist_id, week_start)
);

-- 创建索引
CREATE INDEX idx_settlements_receptionist ON weekly_settlements(receptionist_id);
CREATE INDEX idx_settlements_week ON weekly_settlements(week_start);

-- ============================================
-- 7. 创建业务视图
-- ============================================

-- 老板余额视图 (Boss Balance)
CREATE OR REPLACE VIEW boss_balances AS
SELECT 
  boss_name,
  COALESCE(SUM(
    CASE 
      WHEN type = 'prepaid' AND approved = true THEN amount
      WHEN type = 'deduct_prepaid' AND approved = true THEN -amount
      ELSE 0 
    END
  ), 0) as balance,
  COALESCE(SUM(
    CASE 
      WHEN type = 'prepaid' AND approved = true THEN amount
      WHEN type = 'normal' AND approved = true THEN amount
      WHEN type = 'gift' AND approved = true THEN amount
      WHEN type = 'monthly' AND approved = true THEN 9.9
      ELSE 0 
    END
  ), 0) as total_consumption,
  COUNT(*) FILTER (WHERE type = 'prepaid' AND approved = true) as prepaid_count,
  COUNT(*) FILTER (WHERE type = 'normal' AND approved = true) as normal_count,
  COUNT(*) FILTER (WHERE type = 'monthly' AND approved = true) as monthly_count
FROM orders
GROUP BY boss_name;

-- 工作室每日收入视图
CREATE OR REPLACE VIEW daily_studio_income AS
SELECT 
  date,
  COALESCE(SUM(
    CASE 
      WHEN type IN ('normal', 'prepaid') AND approved = true THEN amount * 0.25
      WHEN type = 'gift' AND approved = true THEN amount * 0.10
      WHEN type = 'monthly' AND approved = true THEN 9.9
      ELSE 0 
    END
  ), 0) as studio_income,
  COUNT(*) FILTER (WHERE approved = true) as order_count
FROM orders
GROUP BY date
ORDER BY date DESC;

-- 接待员月度统计视图
CREATE OR REPLACE VIEW receptionist_monthly_stats AS
SELECT 
  o.receptionist_id,
  u.name,
  u.emoji,
  DATE_TRUNC('month', o.date) as month,
  COUNT(*) as total_orders,
  COUNT(*) FILTER (WHERE o.type = 'monthly') as monthly_count,
  COUNT(*) FILTER (WHERE o.type = 'normal') as normal_count,
  COUNT(*) FILTER (WHERE o.type = 'prepaid') as prepaid_count,
  COUNT(*) FILTER (WHERE o.type = 'gift') as gift_count,
  COUNT(*) FILTER (WHERE o.type = 'bonus') as bonus_count,
  COALESCE(SUM(
    CASE 
      WHEN o.type = 'monthly' THEN 9.9
      WHEN o.type = 'bonus' THEN 0
      ELSE o.amount 
    END
  ), 0) as total_amount
FROM orders o
JOIN users u ON o.receptionist_id = u.id
WHERE o.approved = true
GROUP BY o.receptionist_id, u.name, u.emoji, DATE_TRUNC('month', o.date);

-- ============================================
-- 8. 创建业务函数
-- ============================================

-- 计算接待提成函数
CREATE OR REPLACE FUNCTION calculate_commission(
  p_order_type order_type,
  p_amount DECIMAL,
  p_commission_rate DECIMAL,
  p_commission_expiry TIMESTAMPTZ
) RETURNS DECIMAL AS $$
DECLARE
  rate DECIMAL;
BEGIN
  -- 月卡单和扣除预存不计提成
  IF p_order_type IN ('monthly', 'deduct_prepaid') THEN
    RETURN 0;
  END IF;
  
  -- 奖金全归接待
  IF p_order_type = 'bonus' THEN
    RETURN p_amount;
  END IF;
  
  -- 检查临时提成是否有效
  IF p_commission_expiry IS NOT NULL AND p_commission_expiry > NOW() THEN
    rate := p_commission_rate;
  ELSE
    -- 默认提成: 正常单5%, 礼物单10%, 其他5%
    CASE p_order_type
      WHEN 'normal' THEN rate := 5;
      WHEN 'gift' THEN rate := 10;
      ELSE rate := 5;
    END CASE;
  END IF;
  
  RETURN p_amount * (rate / 100);
END;
$$ LANGUAGE plpgsql;

-- 计算工作室收入函数
CREATE OR REPLACE FUNCTION calculate_studio_income(
  p_order_type order_type,
  p_amount DECIMAL
) RETURNS DECIMAL AS $$
BEGIN
  CASE p_order_type
    WHEN 'normal' THEN RETURN p_amount * 0.25;
    WHEN 'gift' THEN RETURN p_amount * 0.10;
    WHEN 'monthly' THEN RETURN 9.9;
    WHEN 'prepaid' THEN RETURN p_amount * 0.25;
    ELSE RETURN 0;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- 获取周开始日期函数 (周一)
CREATE OR REPLACE FUNCTION get_week_start(p_date DATE DEFAULT CURRENT_DATE)
RETURNS DATE AS $$
BEGIN
  RETURN p_date - EXTRACT(ISODOW FROM p_date)::INT + 1;
END;
$$ LANGUAGE plpgsql;

-- 获取老板余额函数
CREATE OR REPLACE FUNCTION get_boss_balance(p_boss_name VARCHAR)
RETURNS DECIMAL AS $$
DECLARE
  total_prepaid DECIMAL;
  total_deducted DECIMAL;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total_prepaid
  FROM orders 
  WHERE boss_name = p_boss_name 
    AND type = 'prepaid' 
    AND approved = true;
    
  SELECT COALESCE(SUM(amount), 0) INTO total_deducted
  FROM orders 
  WHERE boss_name = p_boss_name 
    AND type = 'deduct_prepaid' 
    AND approved = true;
    
  RETURN total_prepaid - total_deducted;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. 启用 Row Level Security (RLS)
-- 注意: 如果不使用 Supabase Auth, 可以跳过此部分
-- ============================================

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE read_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_settlements ENABLE ROW LEVEL SECURITY;

-- 用户表策略
CREATE POLICY "Users are viewable by everyone" ON users
  FOR SELECT USING (is_deleted = false OR auth.uid()::text = id::text);

CREATE POLICY "Managers can update users" ON users
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id::text = auth.uid()::text AND role = 'manager'
    )
  );

-- 订单表策略
CREATE POLICY "Orders are viewable by authenticated users" ON orders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Receptionists can create orders" ON orders
  FOR INSERT TO authenticated 
  WITH CHECK (receptionist_id::text = auth.uid()::text);

CREATE POLICY "Managers can update orders" ON orders
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id::text = auth.uid()::text AND role = 'manager'
    )
  );

CREATE POLICY "Managers can delete orders" ON orders
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id::text = auth.uid()::text AND role = 'manager'
    )
  );

-- 公告表策略 (所有人可读, 管理员可写)
CREATE POLICY "Announcements viewable by all" ON announcements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Managers can manage announcements" ON announcements
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id::text = auth.uid()::text AND role = 'manager'
    )
  );

-- 惩罚表策略
CREATE POLICY "Penalties viewable by authenticated" ON penalties
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Managers can manage penalties" ON penalties
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id::text = auth.uid()::text AND role = 'manager'
    )
  );

-- ============================================
-- 完成! 
-- ============================================
-- 现在你可以在 Table Editor 中查看所有创建的表
-- 测试: SELECT * FROM users; 应该显示管理者账号
-- ============================================
