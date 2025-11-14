# KPI Rebalancing Engine - POC

A React-based proof of concept demonstrating a DAG (Directed Acyclic Graph) approach to KPI rebalancing for retail and e-commerce merchandising analytics.

## 🎯 Problem Statement

Retail companies track Key Performance Indicators (KPIs) for products across multiple weeks. When a merchandiser edits one KPI (e.g., Sales Units), all dependent KPIs must be recalculated automatically while respecting business constraints and lock strategies.

## 🚀 Features

### 1. **KPI Grid View**
- Interactive spreadsheet-like interface showing KPIs across multiple weeks
- Click any editable cell to modify values
- Real-time recalculation of dependent KPIs
- Visual indicators:
  - 🔵 **Blue cells**: Editable KPIs
  - 🟢 **Green cells**: Calculated KPIs (auto-computed)
  - ⚪ **Gray cells**: Locked KPIs (won't change during this edit)
  - 🟡 **Yellow highlight**: Recently changed values

### 2. **Dependency DAG Visualization**
- Interactive dependency graph using React Flow
- Shows how KPIs depend on each other
- Visual representation of data flow
- Color-coded nodes and animated edges

### 3. **Configuration Editor**
- View and edit KPI formulas
- See dependencies and lock strategies
- Modify calculation logic on-the-fly

## 🧮 Core Algorithm

### Topological Sort
Uses **Kahn's algorithm** to determine the correct calculation order.

### Two-Phase Rebalancing
**Phase 1**: Linear calculations (same week)
**Phase 2**: Multi-week effects (Return Inventory, EOP/BOP transitions)

## 📦 Installation & Usage

```bash
npm install
npm run dev
```

Navigate to http://localhost:5173

## 🎮 Try It Out

1. Click on Week 10, "Sls U" row (blue cell)
2. Change value from 100 to 150
3. Watch dependent KPIs recalculate automatically
4. Yellow highlights show what changed
5. Switch tabs to see DAG visualization and config editor

## 🛠️ Tech Stack

- React 18 + TypeScript
- Vite
- React Flow (DAG visualization)
- MathJS (formula evaluation)
- Lucide React (icons)

## 📊 Demonstrated Scenarios

**Editing Sales Units (Sls U):**
- Locks: DR%, Return %
- Recalculates: COGS, GM $, GM %, Return U, Return $, Net Sls U/$ , EOP U/$
- Multi-week: Updates Week+4 Return Inv, Week+1 BOP

**Built with ❤️ to demonstrate DAG-based merchandising analytics**
