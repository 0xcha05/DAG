-- Seed KPI Configuration Data
-- Populates the kpi_config table with template definitions

USE kpi_engine;

-- Clear existing config (optional, for development)
TRUNCATE TABLE IF EXISTS kpi_config;

-- Insert KPI configurations
INSERT INTO kpi_config (
    kpi_name, display_name, is_editable, formula, description,
    depends_on, locks_when_edited, affects_weeks
) VALUES
    -- ============= EDITABLE KPIs =============
    (
        'Sls U',
        'Sales Units',
        1,  -- editable
        NULL,  -- no formula
        'Total units sold in the period',
        '[]',  -- no dependencies
        '["DR%", "Return %"]',  -- lock these when editing
        '[]'  -- no multi-week effects
    ),
    (
        'Sls $',
        'Sales Dollars',
        1,  -- editable
        NULL,
        'Total sales revenue',
        '[]',
        '["Sls U"]',
        '[]'
    ),
    (
        'DR%',
        'Discount Rate %',
        1,  -- editable
        NULL,
        'Percentage discount applied to sales',
        '[]',
        '["Sls U"]',
        '[]'
    ),
    (
        'Return %',
        'Return Rate %',
        1,  -- editable
        NULL,
        'Percentage of units returned',
        '[]',
        '["Sls U"]',
        '[]'
    ),
    (
        'AUC',
        'Average Unit Cost',
        1,  -- editable
        NULL,
        'Average cost per unit',
        '[]',
        '[]',
        '[]'
    ),
    (
        'BOP U',
        'Beginning of Period Units',
        1,  -- editable
        NULL,
        'Inventory at start of period',
        '[]',
        '[]',
        '[]'
    ),
    (
        'BOP $',
        'Beginning of Period $',
        1,  -- editable
        NULL,
        'Inventory value at start of period',
        '[]',
        '[]',
        '[]'
    ),
    (
        'Total Rcpt U',
        'Total Receipts Units',
        1,  -- editable
        NULL,
        'Units received in period',
        '[]',
        '[]',
        '[]'
    ),
    (
        'Total Rcpt $',
        'Total Receipts $',
        1,  -- editable
        NULL,
        'Dollar value of receipts',
        '[]',
        '[]',
        '[]'
    ),

    -- ============= CALCULATED KPIs (Level 1) =============
    (
        'AUR',
        'Average Unit Retail',
        0,  -- calculated
        'Sls $ / Sls U',
        'Average selling price per unit',
        '["Sls $", "Sls U"]',
        '[]',
        '[]'
    ),
    (
        'COGS',
        'Cost of Goods Sold',
        0,  -- calculated
        'Sls U * AUC',
        'Total cost of units sold',
        '["Sls U", "AUC"]',
        '[]',
        '[]'
    ),
    (
        'Return U',
        'Return Units',
        0,  -- calculated
        'Return % * Sls U',
        'Number of units returned',
        '["Return %", "Sls U"]',
        '[]',
        '[{"offset": 4, "targetKPI": "Return Inv"}]'  -- affects Return Inv 4 weeks later
    ),

    -- ============= CALCULATED KPIs (Level 2) =============
    (
        'GM $',
        'Gross Margin $',
        0,  -- calculated
        'Sls $ - COGS',
        'Gross profit in dollars',
        '["Sls $", "COGS"]',
        '[]',
        '[]'
    ),
    (
        'Return $',
        'Return Dollars',
        0,  -- calculated
        'Return U * AUR',
        'Dollar value of returns',
        '["Return U", "AUR"]',
        '[]',
        '[]'
    ),
    (
        'Net Sls U',
        'Net Sales Units',
        0,  -- calculated
        'Sls U - Return U',
        'Net units after returns',
        '["Sls U", "Return U"]',
        '[]',
        '[]'
    ),

    -- ============= CALCULATED KPIs (Level 3) =============
    (
        'GM %',
        'Gross Margin %',
        0,  -- calculated
        'GM $ / Sls $',
        'Gross margin percentage',
        '["GM $", "Sls $"]',
        '[]',
        '[]'
    ),
    (
        'Net Sls $',
        'Net Sales $',
        0,  -- calculated
        'Sls $ - Return $',
        'Net revenue after returns',
        '["Sls $", "Return $"]',
        '[]',
        '[]'
    ),

    -- ============= INVENTORY KPIs =============
    (
        'Return Inv',
        'Return Inventory',
        0,  -- calculated (special: set from 4 weeks prior)
        NULL,
        'Inventory from returns (4 weeks prior)',
        '[]',
        '[]',
        '[]'
    ),
    (
        'EOP U',
        'End of Period Units',
        0,  -- calculated
        'BOP U - Sls U + Total Rcpt U + Return Inv',
        'Inventory at end of period',
        '["BOP U", "Sls U", "Total Rcpt U", "Return Inv"]',
        '[]',
        '[]'
    ),
    (
        'EOP $',
        'End of Period $',
        0,  -- calculated
        'BOP $ - COGS + Total Rcpt $ + (Return Inv * AUC)',
        'Inventory value at end of period',
        '["BOP $", "COGS", "Total Rcpt $", "Return Inv", "AUC"]',
        '[]',
        '[]'
    ),

    -- ============= ADVANCED KPIs =============
    (
        'FWOS',
        'Forward Weeks of Supply',
        0,  -- calculated
        NULL,  -- Custom calculation (BOP U / Sls U)
        'Weeks of inventory on hand',
        '["BOP U", "Sls U"]',
        '[]',
        '[]'
    ),
    (
        'Rec Rcpt U',
        'Recommended Receipts Units',
        0,  -- calculated
        NULL,  -- Custom calculation
        'Recommended order quantity',
        '["FWOS", "BOP U", "Sls U"]',
        '[]',
        '[]'
    ),
    (
        'Rec Rcpt $',
        'Recommended Receipts $',
        0,  -- calculated
        'Rec Rcpt U * AUC',
        'Dollar value of recommended order',
        '["Rec Rcpt U", "AUC"]',
        '[]',
        '[]'
    );

-- Verify configuration was inserted
SELECT
    kpi_name,
    display_name,
    is_editable,
    formula,
    depends_on,
    locks_when_edited
FROM kpi_config
ORDER BY
    is_editable DESC,  -- Editable first
    kpi_name;

-- Show formulas
SELECT
    kpi_name,
    formula
FROM kpi_config
WHERE formula IS NOT NULL
ORDER BY kpi_name;

-- Show lock strategies
SELECT
    kpi_name,
    locks_when_edited
FROM kpi_config
WHERE locks_when_edited != '[]'
ORDER BY kpi_name;

-- Show multi-week effects
SELECT
    kpi_name,
    affects_weeks
FROM kpi_config
WHERE affects_weeks != '[]'
ORDER BY kpi_name;
