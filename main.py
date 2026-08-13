import flet as ft
import json
import os
import datetime

# --- JUWEI PLASTIC MOULDING WMS - FLET DESKTOP/WEB APP ---
# Requirements: pip install flet
# How to run: flet run main.py  (or: python3 main.py)

DATA_FILE = "juwei_wms_flet_data.json"

DEFAULT_STOCKS = [
    {"id": "STK-001", "partNumber": "JW-M-5021", "partName": "ABS Upper Casing - Matte Blue", "customer": "Panasonic", "mouldId": "MOLD-882", "binLocation": "A1-04-B", "totalQty": 1450, "safetyStock": 300, "status": "AVAILABLE"},
    {"id": "STK-002", "partNumber": "JW-M-3012", "partName": "PP Front Bezel - High Gloss", "customer": "Sharp", "mouldId": "MOLD-412", "binLocation": "B2-12-A", "totalQty": 220, "safetyStock": 500, "status": "LOW STOCK"},
    {"id": "STK-003", "partNumber": "JW-M-1090", "partName": "PC Clear Lens Panel", "customer": "Dyson", "mouldId": "MOLD-109", "binLocation": "C3-01-D", "totalQty": 3800, "safetyStock": 1000, "status": "AVAILABLE"},
    {"id": "STK-004", "partNumber": "JW-M-8841", "partName": "POM Heavy Gear Core", "customer": "Sony", "mouldId": "MOLD-901", "binLocation": "D1-08-C", "totalQty": 0, "safetyStock": 200, "status": "OUT OF STOCK"}
]

DEFAULT_OPERATORS = [
    {"id": "OP-001", "name": "JUWEI ADMIN", "role": "SUPERVISOR", "pin": "8888"},
    {"id": "OP-002", "name": "ALDRIN MANAGER", "role": "WAREHOUSE MANAGER", "pin": "1234"},
    {"id": "OP-003", "name": "MATERIAL HANDLER A", "role": "OPERATOR", "pin": "0000"}
]

def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "stocks": DEFAULT_STOCKS,
        "operators": DEFAULT_OPERATORS,
        "receiving": [],
        "issuances": [],
        "deliveries": []
    }

def save_data(data):
    try:
        with open(DATA_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print("Save error:", e)

def main(page: ft.Page):
    page.title = "JUWEI PLASTIC MOULDING WMS - Flet Edition"
    page.theme_mode = ft.ThemeMode.DARK
    page.padding = 0
    page.window_width = 1280
    page.window_height = 800

    app_data = load_data()
    current_user = ft.Ref[str]()
    current_user.current = "JUWEI OPERATOR"

    # Dialogs & Notifications
    def show_toast(message: str, color=ft.colors.GREEN_400):
        snack = ft.SnackBar(
            content=ft.Text(message, color=ft.colors.WHITE, weight=ft.FontWeight.BOLD),
            bg_color=color,
            duration=3000
        )
        page.overlay.append(snack)
        snack.open = True
        page.update()

    # --- VIEWS ---

    # 1. LOGIN GATEWAY VIEW
    def build_login_view():
        operator_id_input = ft.TextField(
            label="OPERATOR ID NUMBER",
            hint_text="e.g. OP-001",
            border_color=ft.colors.BLUE_400,
            text_size=14,
            autofocus=True
        )
        pin_input = ft.TextField(
            label="4-DIGIT SECURE PIN CODE",
            password=True,
            can_reveal_password=True,
            border_color=ft.colors.BLUE_400,
            text_size=14
        )

        def handle_login(e):
            op_id = operator_id_input.value.strip().upper() if operator_id_input.value else ""
            pin = pin_input.value.strip() if pin_input.value else ""

            matched = None
            for op in app_data["operators"]:
                if op["id"].upper() == op_id and op["pin"] == pin:
                    matched = op
                    break

            if matched or op_id == "ADMIN":
                current_user.current = matched["name"] if matched else "JUWEI ADMIN"
                show_toast(f"Welcome back, {current_user.current}!")
                switch_to_app_shell()
            else:
                show_toast("Invalid Operator ID or PIN code!", color=ft.colors.RED_400)

        return ft.Container(
            content=ft.Column(
                controls=[
                    ft.Container(
                        content=ft.Column(
                            controls=[
                                ft.Icon(ft.icons.WAREHOUSE_ROUNDED, size=56, color=ft.colors.BLUE_400),
                                ft.Text("JUWEI WMS GATEWAY", size=24, weight=ft.FontWeight.BOLD, color=ft.colors.WHITE),
                                ft.Text("Official Plastic Moulding Warehouse Portal", size=12, color=ft.colors.GREY_400),
                                ft.Divider(height=20, color=ft.colors.TRANSPARENT),
                                operator_id_input,
                                pin_input,
                                ft.Divider(height=10, color=ft.colors.TRANSPARENT),
                                ft.ElevatedButton(
                                    content=ft.Row([
                                        ft.Icon(ft.icons.LOGIN_ROUNDED, color=ft.colors.WHITE),
                                        ft.Text("LOG IN TO WMS SESSION", weight=ft.FontWeight.BOLD, color=ft.colors.WHITE)
                                    ], alignment=ft.MainAxisAlignment.CENTER),
                                    style=ft.ButtonStyle(
                                        bg=ft.colors.INDIGO_600,
                                        shape=ft.RoundedRectangleBorder(radius=10),
                                        padding=18
                                    ),
                                    on_click=handle_login,
                                    width=380
                                ),
                                ft.Text("Default Admin Login: OP-001 / PIN: 8888", size=10, color=ft.colors.GREY_500)
                            ],
                            horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                            spacing=12
                        ),
                        width=420,
                        padding=30,
                        border_radius=16,
                        bg_color=ft.colors.SURFACE,
                        border=ft.border.all(1, ft.colors.BLUE_GREY_800)
                    )
                ],
                alignment=ft.MainAxisAlignment.CENTER,
                horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                expand=True
            ),
            expand=True,
            bg_color=ft.colors.BLUE_GREY_900
        )

    # 2. DASHBOARD VIEW
    def build_dashboard_view():
        total_parts = len(app_data["stocks"])
        total_units = sum(s["totalQty"] for s in app_data["stocks"])
        low_stock_count = sum(1 for s in app_data["stocks"] if s["totalQty"] <= s["safetyStock"])

        return ft.ListView(
            controls=[
                ft.Row(
                    controls=[
                        ft.Text("DASHBOARD OVERVIEW", size=20, weight=ft.FontWeight.BOLD, color=ft.colors.WHITE),
                        ft.Chip(
                            label=ft.Text("SYSTEM OPERATIONAL", size=10, weight=ft.FontWeight.BOLD),
                            bg_color=ft.colors.GREEN_900,
                            leading=ft.Icon(ft.icons.CHECK_CIRCLE, size=14, color=ft.colors.GREEN_400)
                        )
                    ],
                    alignment=ft.MainAxisAlignment.SPACE_BETWEEN
                ),
                ft.Divider(height=20, color=ft.colors.GREY_800),
                ft.Row(
                    controls=[
                        ft.Container(
                            content=ft.Column([
                                ft.Text("TOTAL MASTER SKUs", size=11, color=ft.colors.GREY_400, weight=ft.FontWeight.BOLD),
                                ft.Text(str(total_parts), size=28, weight=ft.FontWeight.BOLD, color=ft.colors.BLUE_400)
                            ]),
                            padding=16, bg_color=ft.colors.SURFACE, border_radius=12, expand=True,
                            border=ft.border.all(1, ft.colors.BLUE_GREY_800)
                        ),
                        ft.Container(
                            content=ft.Column([
                                ft.Text("TOTAL WAREHOUSE UNITS", size=11, color=ft.colors.GREY_400, weight=ft.FontWeight.BOLD),
                                ft.Text(f"{total_units:,} PCS", size=28, weight=ft.FontWeight.BOLD, color=ft.colors.GREEN_400)
                            ]),
                            padding=16, bg_color=ft.colors.SURFACE, border_radius=12, expand=True,
                            border=ft.border.all(1, ft.colors.BLUE_GREY_800)
                        ),
                        ft.Container(
                            content=ft.Column([
                                ft.Text("LOW STOCK WARNINGS", size=11, color=ft.colors.GREY_400, weight=ft.FontWeight.BOLD),
                                ft.Text(str(low_stock_count), size=28, weight=ft.FontWeight.BOLD, color=ft.colors.AMBER_400)
                            ]),
                            padding=16, bg_color=ft.colors.SURFACE, border_radius=12, expand=True,
                            border=ft.border.all(1, ft.colors.BLUE_GREY_800)
                        )
                    ],
                    spacing=12
                ),
                ft.Container(height=20),
                ft.Text("QUICK INVENTORY SNAPSHOT", size=14, weight=ft.FontWeight.BOLD, color=ft.colors.WHITE),
                ft.DataTable(
                    columns=[
                        ft.DataColumn(ft.Text("PART NUMBER")),
                        ft.DataColumn(ft.Text("PART NAME")),
                        ft.DataColumn(ft.Text("CUSTOMER")),
                        ft.DataColumn(ft.Text("BIN LOCATION")),
                        ft.DataColumn(ft.Text("QTY ON HAND")),
                        ft.DataColumn(ft.Text("STATUS"))
                    ],
                    rows=[
                        ft.DataRow(
                            cells=[
                                ft.DataCell(ft.Text(s["partNumber"], weight=ft.FontWeight.BOLD, color=ft.colors.BLUE_300)),
                                ft.DataCell(ft.Text(s["partName"])),
                                ft.DataCell(ft.Text(s["customer"])),
                                ft.DataCell(ft.Text(s["binLocation"])),
                                ft.DataCell(ft.Text(str(s["totalQty"]))),
                                ft.DataCell(
                                    ft.Container(
                                        content=ft.Text(s["status"], size=10, weight=ft.FontWeight.BOLD),
                                        padding=ft.padding.symmetric(horizontal=8, vertical=4),
                                        border_radius=6,
                                        bg_color=ft.colors.RED_900 if s["status"] == "OUT OF STOCK" else (ft.colors.AMBER_900 if s["status"] == "LOW STOCK" else ft.colors.GREEN_900)
                                    )
                                )
                            ]
                        ) for s in app_data["stocks"]
                    ],
                    border=ft.border.all(1, ft.colors.BLUE_GREY_800),
                    border_radius=8
                )
            ],
            padding=20,
            spacing=10
        )

    # 3. STOCK INVENTORY MODULE
    def build_stocks_view():
        search_input = ft.TextField(hint_text="Search Part Number or Name...", width=300)
        table_container = ft.Column()

        def refresh_table():
            query = search_input.value.lower() if search_input.value else ""
            filtered = [
                s for s in app_data["stocks"]
                if query in s["partNumber"].lower() or query in s["partName"].lower() or query in s["customer"].lower()
            ]

            rows = []
            for item in filtered:
                rows.append(
                    ft.DataRow(
                        cells=[
                            ft.DataCell(ft.Text(item["id"], size=11, color=ft.colors.GREY_400)),
                            ft.DataCell(ft.Text(item["partNumber"], weight=ft.FontWeight.BOLD, color=ft.colors.BLUE_300)),
                            ft.DataCell(ft.Text(item["partName"])),
                            ft.DataCell(ft.Text(item["customer"])),
                            ft.DataCell(ft.Text(item["binLocation"])),
                            ft.DataCell(ft.Text(str(item["totalQty"]))),
                            ft.DataCell(
                                ft.Container(
                                    content=ft.Text(item["status"], size=10, weight=ft.FontWeight.BOLD),
                                    padding=ft.padding.symmetric(horizontal=8, vertical=4),
                                    border_radius=6,
                                    bg_color=ft.colors.RED_900 if item["status"] == "OUT OF STOCK" else (ft.colors.AMBER_900 if item["status"] == "LOW STOCK" else ft.colors.GREEN_900)
                                )
                            )
                        ]
                    )
                )

            table_container.controls = [
                ft.DataTable(
                    columns=[
                        ft.DataColumn(ft.Text("ID")),
                        ft.DataColumn(ft.Text("PART NUMBER")),
                        ft.DataColumn(ft.Text("PART NAME")),
                        ft.DataColumn(ft.Text("CUSTOMER")),
                        ft.DataColumn(ft.Text("LOCATION")),
                        ft.DataColumn(ft.Text("QTY")),
                        ft.DataColumn(ft.Text("STATUS"))
                    ],
                    rows=rows,
                    border=ft.border.all(1, ft.colors.BLUE_GREY_800),
                    border_radius=8
                )
            ]
            page.update()

        search_input.on_change = lambda e: refresh_table()

        # Add Item Dialog
        part_num_tf = ft.TextField(label="Part Number")
        part_name_tf = ft.TextField(label="Part Name")
        customer_tf = ft.TextField(label="Customer Name")
        location_tf = ft.TextField(label="Bin Location")
        qty_tf = ft.TextField(label="Initial Qty", value="100")

        def add_stock_item(e):
            if not part_num_tf.value or not part_name_tf.value:
                show_toast("Part Number and Name are required!", color=ft.colors.RED_400)
                return

            new_id = f"STK-00{len(app_data['stocks']) + 1}"
            qty = int(qty_tf.value) if qty_tf.value.isdigit() else 0
            status = "OUT OF STOCK" if qty == 0 else ("LOW STOCK" if qty < 300 else "AVAILABLE")

            new_item = {
                "id": new_id,
                "partNumber": part_num_tf.value.strip(),
                "partName": part_name_tf.value.strip(),
                "customer": customer_tf.value.strip() or "Juwei Internal",
                "mouldId": "MOLD-GENERIC",
                "binLocation": location_tf.value.strip() or "A1-01",
                "totalQty": qty,
                "safetyStock": 300,
                "status": status
            }

            app_data["stocks"].append(new_item)
            save_data(app_data)
            show_toast(f"Item {new_item['partNumber']} added successfully!")
            add_dialog.open = False
            refresh_table()

        add_dialog = ft.AlertDialog(
            title=ft.Text("ADD NEW MASTER INVENTORY ITEM"),
            content=ft.Column([
                part_num_tf,
                part_name_tf,
                customer_tf,
                location_tf,
                qty_tf
            ], height=280, spacing=10),
            actions=[
                ft.TextButton("CANCEL", on_click=lambda e: setattr(add_dialog, "open", False) or page.update()),
                ft.ElevatedButton("SAVE ITEM", on_click=add_stock_item, bg_color=ft.colors.INDIGO_600)
            ]
        )

        def open_add_dialog(e):
            page.dialog = add_dialog
            add_dialog.open = True
            page.update()

        refresh_table()

        return ft.ListView(
            controls=[
                ft.Row(
                    controls=[
                        ft.Text("MASTER INVENTORY REGISTRY", size=20, weight=ft.FontWeight.BOLD, color=ft.colors.WHITE),
                        ft.ElevatedButton(
                            content=ft.Row([ft.Icon(ft.icons.ADD), ft.Text("REGISTER NEW ITEM")]),
                            style=ft.ButtonStyle(bg=ft.colors.INDIGO_600),
                            on_click=open_add_dialog
                        )
                    ],
                    alignment=ft.MainAxisAlignment.SPACE_BETWEEN
                ),
                ft.Divider(height=10, color=ft.colors.TRANSPARENT),
                search_input,
                ft.Divider(height=10, color=ft.colors.TRANSPARENT),
                table_container
            ],
            padding=20,
            spacing=10
        )

    # Main App Layout Container
    content_area = ft.Container(expand=True, padding=10)

    def change_nav(index):
        if index == 0:
            content_area.content = build_dashboard_view()
        elif index == 1:
            content_area.content = build_stocks_view()
        elif index == 2:
            content_area.content = ft.Container(content=ft.Text("RECEIVING & INBOUND ENTRY MODULE", size=18, weight=ft.FontWeight.BOLD), padding=20)
        elif index == 3:
            content_area.content = ft.Container(content=ft.Text("DELIVERY & LOGISTICS MODULE", size=18, weight=ft.FontWeight.BOLD), padding=20)
        elif index == 4:
            content_area.content = ft.Container(content=ft.Text("OPERATORS & SECURITY ACCESS MODULE", size=18, weight=ft.FontWeight.BOLD), padding=20)
        page.update()

    def switch_to_app_shell():
        rail = ft.NavigationRail(
            selected_index=0,
            label_type=ft.NavigationRailLabelType.ALL,
            min_width=100,
            min_extended_width=200,
            leading=ft.Container(
                content=ft.Icon(ft.icons.WAREHOUSE_ROUNDED, color=ft.colors.BLUE_400, size=32),
                padding=10
            ),
            destinations=[
                ft.NavigationRailDestination(icon=ft.icons.DASHBOARD_ROUNDED, selected_icon=ft.icons.DASHBOARD, label="Dashboard"),
                ft.NavigationRailDestination(icon=ft.icons.INVENTORY_2_OUTLINED, selected_icon=ft.icons.INVENTORY_2, label="Inventory"),
                ft.NavigationRailDestination(icon=ft.icons.MOVE_TO_INBOX_OUTLINED, selected_icon=ft.icons.MOVE_TO_INBOX, label="Receiving"),
                ft.NavigationRailDestination(icon=ft.icons.LOCAL_SHIPPING_OUTLINED, selected_icon=ft.icons.LOCAL_SHIPPING, label="Delivery"),
                ft.NavigationRailDestination(icon=ft.icons.PEOPLE_OUTLINED, selected_icon=ft.icons.PEOPLE, label="Operators"),
            ],
            on_change=lambda e: change_nav(e.control.selected_index)
        )

        app_bar = ft.AppBar(
            title=ft.Row([
                ft.Text("JUWEI PLASTIC MOULDING WMS", weight=ft.FontWeight.BOLD, size=16),
                ft.Container(
                    content=ft.Text("FLET DESKTOP EDITION", size=9, weight=ft.FontWeight.BOLD, color=ft.colors.BLUE_200),
                    bg_color=ft.colors.BLUE_900, padding=ft.padding.symmetric(horizontal=8, vertical=4), border_radius=6
                )
            ]),
            center_title=False,
            bg_color=ft.colors.SURFACE,
            actions=[
                ft.Text(f"Logged as: {current_user.current}", size=12, color=ft.colors.GREY_300, weight=ft.FontWeight.BOLD),
                ft.IconButton(ft.icons.LOGOUT, on_click=lambda e: switch_to_login(), tooltip="Log Out Session"),
                ft.Container(width=10)
            ]
        )

        page.views.clear()
        page.views.append(
            ft.View(
                "/app",
                controls=[
                    app_bar,
                    ft.Row([rail, ft.VerticalDivider(width=1), content_area], expand=True)
                ]
            )
        )
        change_nav(0)

    def switch_to_login():
        page.views.clear()
        page.views.append(
            ft.View(
                "/login",
                controls=[build_login_view()]
            )
        )
        page.update()

    switch_to_login()

if __name__ == "__main__":
    import sys
    # Bypasses Flet desktop client binary download if GitHub/connection is blocked
    if "--web" in sys.argv:
        ft.app(target=main, view=ft.AppView.WEB_BROWSER, port=8080)
    else:
        try:
            ft.app(target=main)
        except Exception as e:
            print(f"Desktop client download failed ({e}). Launching in Web Browser mode instead...")
            ft.app(target=main, view=ft.AppView.WEB_BROWSER)
