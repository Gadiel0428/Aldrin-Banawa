# JUWEI WMS - Flet (Python Framework) Application Guide

This repository now includes a **complete, standalone Python Flet implementation** (`main.py`) converted directly from the JUWEI Plastic Moulding Warehouse Management System (WMS).

---

## 🚀 How to Run `main.py` on your Desktop / Local PC

### 1. Requirements
Ensure you have Python 3.8+ installed on your computer.

### 2. Install Flet
Open your terminal or command prompt and run:
```bash
pip install flet
```

### 3. Launch the App
Run the Flet app:
```bash
flet run main.py
```
*(Or run standard Python: `python main.py` or `python3 main.py`)*

---

## 📱 Features Built into `main.py`
- **Gateway Operator Authentication**: Secure 4-digit PIN access for operators (e.g. `OP-001` / PIN `8888`).
- **Dashboard Overview**: Live inventory totals, total warehouse units, low stock alerts, and quick inventory snapshot.
- **Master Inventory Registry**: Full table view, live multi-keyword search filter, and "Register New Item" dialog modal.
- **Local Data Persistence**: Saves and loads all inventory updates to `juwei_wms_flet_data.json` automatically.
- **Cross-Platform Compatibility**: Runs natively on Windows, macOS, Linux, Android/iOS (via Flet CLI), or as a Python Web Server (`flet run --web main.py`).

---

## 🌐 Deploy as a Flet Web Application
To serve the Flet app over HTTP on a local server or Cloud VPS:
```bash
flet run --web --port 8080 main.py
```
Then open `http://localhost:8080` in any web browser.
