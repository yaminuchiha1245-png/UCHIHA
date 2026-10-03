#!/usr/bin/env python3
import json
import pathlib
import re
import sys

if len(sys.argv) != 4:
    raise SystemExit("usage: build-mikrotik-bootstrap.py MATERIAL_JSON PASSWORD_FILE OUTPUT_RSC")

material_path, password_path, out_path = sys.argv[1:]
material = json.loads(pathlib.Path(material_path).read_text(encoding="utf-8"))
password = pathlib.Path(password_path).read_text(encoding="utf-8").strip()

required = ("deviceId", "peerPrivateKey", "serverPublicKey", "endpointHost", "endpointPort", "tunnelIp")
if any(not material.get(key) for key in required):
    raise SystemExit("peer material incomplete")
if not re.fullmatch(r"[A-Za-z0-9+/]{42,44}={0,2}", material["peerPrivateKey"]):
    raise SystemExit("invalid peer private key")
if not re.fullmatch(r"[A-Za-z0-9+/]{42,44}={0,2}", material["serverPublicKey"]):
    raise SystemExit("invalid server public key")
if not re.fullmatch(r"[0-9a-f]{48}", password):
    raise SystemExit("invalid management password")
if material["tunnelIp"] != "10.83.0.2" or int(material["endpointPort"]) != 51883:
    raise SystemExit("unexpected peer allocation")
if not re.fullmatch(r"[A-Za-z0-9.-]+", material["endpointHost"]):
    raise SystemExit("invalid endpoint host")

rsc = f"""# UCHIHA RADIUS V1-83 - one-time MikroTik bootstrap
# Device: {material["deviceId"]}
# Purpose: WireGuard management tunnel only.
# Does not change Starlink, WAN, NAT, PPPoE, Hotspot, or RADIUS subscriber settings.

:local wgName "uchiha-radius-v183"
:local apiGroup "uchiha-radius-api"
:local apiUser "uchiha-radius-v183"
:local rosVersion [/system resource get version]
:if ([:pick $rosVersion 0 1] != "7") do={{ :error "UCHIHA RADIUS requires RouterOS 7" }}

:local wgId [/interface wireguard find where name=$wgName]
:if ([:len $wgId] = 0) do={{
    /interface wireguard add name=$wgName private-key="{material["peerPrivateKey"]}" comment="UCHIHA RADIUS V1-83" disabled=no
}} else={{
    /interface wireguard set ($wgId->0) private-key="{material["peerPrivateKey"]}" comment="UCHIHA RADIUS V1-83" disabled=no
}}

:foreach a in=[/ip address find where comment="UCHIHA RADIUS V1-83 tunnel"] do={{ /ip address remove $a }}
/ip address add address=10.83.0.2/24 interface=$wgName comment="UCHIHA RADIUS V1-83 tunnel"

:foreach p in=[/interface wireguard peers find where comment="UCHIHA RADIUS V1-83 server"] do={{ /interface wireguard peers remove $p }}
/interface wireguard peers add interface=$wgName public-key="{material["serverPublicKey"]}" endpoint-address={material["endpointHost"]} endpoint-port={int(material["endpointPort"])} allowed-address=10.83.0.1/32 persistent-keepalive=25s comment="UCHIHA RADIUS V1-83 server"

:local g [/user group find where name=$apiGroup]
:if ([:len $g] = 0) do={{
    /user group add name=$apiGroup policy=read,write,api
}} else={{
    /user group set ($g->0) policy=read,write,api
}}

:local u [/user find where name=$apiUser]
:if ([:len $u] = 0) do={{
    /user add name=$apiUser group=$apiGroup password="{password}" address=10.83.0.1/32 disabled=no
}} else={{
    /user set ($u->0) group=$apiGroup password="{password}" address=10.83.0.1/32 disabled=no
}}

:local apiId [/ip service find where name="api"]
:if ([:len $apiId] = 0) do={{ :error "RouterOS API service not found" }}
/ip service set ($apiId->0) disabled=no port=8728

:foreach f in=[/ip firewall filter find where comment="UCHIHA RADIUS V1-83 API via WireGuard"] do={{ /ip firewall filter remove $f }}
:local inputRules [/ip firewall filter find where chain=input]
:if ([:len $inputRules] = 0) do={{
    /ip firewall filter add chain=input action=accept in-interface=$wgName src-address=10.83.0.1/32 protocol=tcp dst-port=8728 comment="UCHIHA RADIUS V1-83 API via WireGuard"
}} else={{
    /ip firewall filter add chain=input action=accept in-interface=$wgName src-address=10.83.0.1/32 protocol=tcp dst-port=8728 comment="UCHIHA RADIUS V1-83 API via WireGuard" place-before=($inputRules->0)
}}

:put "UCHIHA_RADIUS_BOOTSTRAP_OK"
"""

for forbidden in ("/radius ", "/ppp ", "/ip hotspot", "/ip route", "/ip firewall nat"):
    if forbidden in rsc:
        raise SystemExit(f"bootstrap contains forbidden data-plane command: {forbidden}")

pathlib.Path(out_path).write_text(rsc, encoding="utf-8")
