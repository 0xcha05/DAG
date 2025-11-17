-- Seed data for KPI Rebalancing Engine
-- Inserts initial sample data for demonstration

USE kpi_engine;

-- Clear existing data (optional, for development)
TRUNCATE TABLE IF EXISTS kpi_data;
TRUNCATE TABLE IF EXISTS kpi_audit_log;

-- Insert data for Product 001: iPhone Case - Premium
-- Weeks 8-15 of 2024

INSERT INTO kpi_data (
    product_id, product_name, week, year,
    sls_u, sls_dollars, aur, auc, dr_percent,
    return_percent, return_u, return_dollars,
    cogs, gm_dollars, gm_percent,
    net_sls_u, net_sls_dollars,
    bop_u, bop_dollars, eop_u, eop_dollars,
    total_rcpt_u, total_rcpt_dollars, return_inv,
    fwos, rec_rcpt_u, rec_rcpt_dollars
) VALUES
    -- Week 8
    (
        'PROD-001', 'iPhone Case - Premium', 8, 2024,
        90, 900, 10, 6, 0.2,
        0.1, 9, 90,
        540, 360, 0.4,
        81, 810,
        480, 2880, 431, 2586,
        50, 300, 0,
        5.333, 0, 0
    ),
    -- Week 9
    (
        'PROD-001', 'iPhone Case - Premium', 9, 2024,
        95, 950, 10, 6, 0.2,
        0.1, 9.5, 95,
        570, 380, 0.4,
        85.5, 855,
        490, 2940, 435.5, 2613,
        50, 300, 0,
        5.158, 0, 0
    ),
    -- Week 10
    (
        'PROD-001', 'iPhone Case - Premium', 10, 2024,
        100, 1000, 10, 6, 0.2,
        0.1, 10, 100,
        600, 400, 0.4,
        90, 900,
        500, 3000, 440, 2640,
        50, 300, 0,
        5.0, 0, 0
    ),
    -- Week 11
    (
        'PROD-001', 'iPhone Case - Premium', 11, 2024,
        105, 1050, 10, 6, 0.2,
        0.1, 10.5, 105,
        630, 420, 0.4,
        94.5, 945,
        510, 3060, 444.5, 2667,
        50, 300, 0,
        4.857, 0, 0
    ),
    -- Week 12 (first week with return inventory from week 8)
    (
        'PROD-001', 'iPhone Case - Premium', 12, 2024,
        110, 1100, 10, 6, 0.2,
        0.1, 11, 110,
        660, 440, 0.4,
        99, 990,
        520, 3120, 457.1, 2742.6,
        50, 300, 8.1,  -- return_inv from week 8: 9 * 0.9 = 8.1
        4.727, 0, 0
    ),
    -- Week 13 (return inventory from week 9)
    (
        'PROD-001', 'iPhone Case - Premium', 13, 2024,
        115, 1150, 10, 6, 0.2,
        0.1, 11.5, 115,
        690, 460, 0.4,
        103.5, 1035,
        530, 3180, 462.05, 2772.3,
        50, 300, 8.55,  -- return_inv from week 9: 9.5 * 0.9 = 8.55
        4.609, 0, 0
    ),
    -- Week 14 (return inventory from week 10)
    (
        'PROD-001', 'iPhone Case - Premium', 14, 2024,
        120, 1200, 10, 6, 0.2,
        0.1, 12, 120,
        720, 480, 0.4,
        108, 1080,
        540, 3240, 467, 2802,
        50, 300, 9,  -- return_inv from week 10: 10 * 0.9 = 9
        4.5, 0, 0
    ),
    -- Week 15 (return inventory from week 11)
    (
        'PROD-001', 'iPhone Case - Premium', 15, 2024,
        125, 1250, 10, 6, 0.2,
        0.1, 12.5, 125,
        750, 500, 0.4,
        112.5, 1125,
        550, 3300, 471.95, 2831.7,
        50, 300, 9.45,  -- return_inv from week 11: 10.5 * 0.9 = 9.45
        4.4, 0, 0
    );

-- Insert data for Product 002: Phone Screen Protector (for future multi-product support)
INSERT INTO kpi_data (
    product_id, product_name, week, year,
    sls_u, sls_dollars, aur, auc, dr_percent,
    return_percent, return_u, return_dollars,
    cogs, gm_dollars, gm_percent,
    net_sls_u, net_sls_dollars,
    bop_u, bop_dollars, eop_u, eop_dollars,
    total_rcpt_u, total_rcpt_dollars, return_inv,
    fwos, rec_rcpt_u, rec_rcpt_dollars
) VALUES
    -- Week 8
    (
        'PROD-002', 'Phone Screen Protector', 8, 2024,
        200, 1000, 5, 2, 0.15,
        0.05, 10, 50,
        400, 600, 0.6,
        190, 950,
        800, 1600, 610, 1220,
        100, 200, 0,
        4.0, 0, 0
    ),
    -- Week 9
    (
        'PROD-002', 'Phone Screen Protector', 9, 2024,
        210, 1050, 5, 2, 0.15,
        0.05, 10.5, 52.5,
        420, 630, 0.6,
        199.5, 997.5,
        810, 1620, 609.5, 1219,
        100, 200, 0,
        3.857, 0, 0
    ),
    -- Week 10
    (
        'PROD-002', 'Phone Screen Protector', 10, 2024,
        220, 1100, 5, 2, 0.15,
        0.05, 11, 55,
        440, 660, 0.6,
        209, 1045,
        820, 1640, 609, 1218,
        100, 200, 0,
        3.727, 0, 0
    );

-- Verify data insertion
SELECT
    product_id,
    product_name,
    COUNT(*) as week_count,
    MIN(week) as min_week,
    MAX(week) as max_week
FROM kpi_data
GROUP BY product_id, product_name
ORDER BY product_id;

-- Show sample data
SELECT
    product_name,
    week,
    sls_u,
    sls_dollars,
    gm_percent,
    eop_u
FROM kpi_data
WHERE product_id = 'PROD-001'
ORDER BY week;
