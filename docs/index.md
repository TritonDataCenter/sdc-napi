---
title: Networking API (NAPI)
apisections: Nic Tags, Networks, IPs, Fabrics, Fabric VLANs, Fabric Networks, Nics, Network Pools, Search, Link Aggregations
markdown2extras: tables, code-friendly, fenced-code-blocks
---
<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2017, Joyent, Inc.
-->

# Networking API (NAPI)


# Introduction to the Networking API


## What is NAPI?

The Networking API allows for administering the following:

- Nic Tags
- Logical Networks
- Logical Network Pools
- Fabrics
- IPs
- Nics
- Link Aggregations

NAPI itself is just a directory of the above - it does not handle communicating
these changes to servers, which is the domain of
[VMAPI](https://mo.joyent.com/docs/vmapi/master) and
[CNAPI](https://mo.joyent.com/docs/cnapi/master).


## IP and Nic Provisioning

When you [create a nic](#CreateNic) in NAPI, you can specify a MAC address and
IP address. If you do not pick a MAC address, one will be generated at random
for the new nic. If you do not pick an IP address, the next available address
on the logical network will be used.  The next available address is chosen
in the following way:

* If there are IPs in the network that have never been used, pick the lowest
  one that doesn't have `belongs_to_uuid` set and is unreserved.
* If all IPs in the network have been used before, pick the least
  recently used unreserved IP.

Based on the above, [setting the **reserved** property on an IP](#UpdateIP)
removes it from the automatic selection process. It can still be used by
specifying it as **ip** when [creating a nic](#CreateNic).
[Setting the **free** property on an IP](#UpdateIP) removes all other
properties from the IP (including **reserved**, **belongs_to_uuid**, and
**belongs_to_type**).  This therefore makes the IP available for automatic
provisioning again.


# Nic Tags

## Nic Tag Concepts

These endpoints manage nic tags.  Nic tags are intended to represent physical
network connectivity of nics.  There are two components to this: physical
server nics that *provide* the nic tags, and VM virtual nics that *attach*
to a nic tag.

For physical server nics, you can specify that a server's nic has a nic tag
(using the `nic_tags_provided` property - see [Nics](#nics) below).  This
indicates that this nic is able to reach all other server nics attached to
the same nic tag.  For example, if you add "external" to the
`nic_tags_provided` of one of Server A's nics, that nic should have Layer 2
connectivity with all other nics that are also tagged with the "external"
tag.  You can also tag [link aggregations](#link-aggregations) with tags in
`nic_tags_provided`, since they also provide Layer 2 connectivity.

For VM virtual nics, you do not set `nic_tags_provided` - instead, each nic
has a `nic_tag` property (either set manually, or inherited from its
[Logical Network](#networks)).  This allows the rest of the SDC provisioning
stack to not have to worry about how networks are physically connected - when
provisioning or migrating a VM, you only need to confirm that the destination
server has nics that provide the tags required.

If you provision a nic on the "external" nic tag (for example), when the
VM provision request is sent to the Compute Node, it looks for a physical nic
that provides the "external" nic tag, and creates a Virtual Nic (vnic) over
that physical interface.  You can inspect the nic tags provided on a Compute
Node using the [nictagadm (1m)](https://smartos.org/man/1m/nictagadm) and
[sysinfo (1m)](https://smartos.org/man/1m/sysinfo) tools.  You can inspect the
nic tags of a VM on a Compute Node using the
[vmadm (1m)](https://smartos.org/man/1m/vmadm) tool.

## Nic Tag MTUs

Setting the MTU of nic tags allows you to set the MTU of physical nics on
Compute Nodes that have that tag.  When a Compute Node reboots, it gets the
MTU of all nic tags for a physical nic, and sets the MTU of that nic to the
maximum of all of those MTUs.

MTUs for nic tags have a minimum value of **1500** and a maximum value of
**9000**.  Networks created on a nic tag cannot have an MTU higher than the MTU
of the nic tag they're created on.


## ListNicTags (GET /nic_tags)

Returns a list of all nic tags.

### Inputs

| Field  | Type    | Description                                                |
| ------ | ------- | ---------------------------------------------------------- |
| offset | Integer | Starting offset, see [Pagination](#pagination)             |
| limit  | Integer | Maximum number of responses, see [Pagination](#pagination) |

### Example

    GET /nic_tags
    [
      {
        "mtu": 1500,
        "uuid": "bc7e140a-f1fe-49fd-8b70-26379fa04492",
        "name": "admin"
      },
      {
        "mtu": 1500,
        "uuid": "99ec3b5a-4291-4a40-ba0d-abf7ba1e6e4f",
        "name": "external"
      }
    ]


## GetNicTag (GET /nic_tags/:name)

Returns the named nic tag.

### Example

    GET /nic_tags/admin
    {
      "uuid": "bc7e140a-f1fe-49fd-8b70-26379fa04492",
      "name": "admin",
      "mtu": 1500
    }


## CreateNicTag (POST /nic_tags)

Creates a nic tag.

### Inputs

| Field  | Type    | Description                                                |
| ------ | ------- | ---------------------------------------------------------- |
| name   | String  | nic tag name                                               |
| mtu    | Number  | MTU of underlying physical network                         |

### Example

    POST /nic_tags
        -d name=internal
    {
      "uuid": "856e77b0-c0b2-4a6a-8c17-4ec1017360af",
      "name": "internal"
    }


## UpdateNicTag (PUT /nic_tags/:name)

Updates a nic tag.

### Inputs

| Field | Type   | Description                        |
| ----- | ------ | ---------------------------------- |
| name  | String | new nic tag name                   |
| mtu   | Number | MTU of underlying physical network |

### Example

    PUT /nic_tags/internal
        -d name=private
    {
      "uuid": "df4c1682-a77d-11e2-aafc-5354b5c883c7",
      "name": "private"
    }


## DeleteNicTag (DELETE /nic_tags/:name)

Deletes a nic tag.

### Inputs

None.

### Returns

No response payload, only a "204 No Content" response status.



# Networks

These endpoints manage logical networks.


## ListNetworks (GET /networks)

Returns a list of all logical networks.

### Inputs

All parameters are optional filters on the list. A network will be listed if
it matches *all* of the input parameters.

| Field            | Type            | Description                                                |
| ---------------- | --------------- | ---------------------------------------------------------- |
| fabric           | Boolean         | Whether the network is on a fabric or not                  |
| family           | String          | Return networks of the given family (one of 'ipv4' or 'ipv6') |
| name             | String or Array | Network name                                               |
| vlan_id          | Integer         | VLAN ID                                                    |
| nic_tag          | String or Array | Nic Tag name                                               |
| owner_uuid       | UUID            | Return networks that are owned by this owner_uuid          |
| provisionable_by | UUID            | Return networks that are provisionable by this owner_uuid  |
| offset           | Integer         | Starting offset, see [Pagination](#pagination)             |
| limit            | Integer         | Maximum number of responses, see [Pagination](#pagination) |


**Notes:**

* Both the `name` and `nic_tag` arguments allow for arrays of network
  names and network tags to be provided respectively. When multiple
  names or nic tags are provided, if a name or nic tag matches any one
  of the entries, then it will be included in the results. One can think
  of an array of entries as being equivalent to a logical OR.

* *`provisionable_by`* is intended to list networks that a UFDS user can
  provision on. This includes both networks that contain that user in its
  `owner_uuids` and networks with `owner_uuids` unset. Filtering by
  `owner_uuid`, on the other hand, will only return networks with that owner
  in `owner_uuids` (not networks with `owner_uuids` unset).

### Example

    GET /networks
    [
      {
        "uuid": "1275886f-3fdf-456e-bba6-28e0e2eab58f",
        "name": "admin",
        "vlan_id": 0,
        "family": "ipv4",
        "subnet": "10.99.99.0/24",
        "netmask": "255.255.255.0",
        "provision_start_ip": "10.99.99.189",
        "provision_end_ip": "10.99.99.250",
        "resolvers": [
          "8.8.4.4",
          "8.8.8.8"
        ],
        "gateway": "10.99.99.7"
      },
      {
        "uuid": "c9306c59-f0d6-4aa0-aa0c-17d22a6a3f0f",
        "name": "external",
        "vlan_id": 128,
        "family": "ipv4",
        "subnet": "10.88.88.0/24",
        "netmask": "255.255.255.0",
        "provision_start_ip": "10.88.88.189",
        "provision_end_ip": "10.88.88.250",
        "resolvers": [
          "8.8.4.4",
          "8.8.8.8"
        ],
        "gateway": "10.88.88.2"
      }
    ]


## CreateNetwork (POST /networks)

Creates a new logical network

### Inputs

| Field              | Type           | Description                                                     |
| ------------------ | -------------- | --------------------------------------------------------------- |
| name               | String         | network name                                                    |
| vlan_id            | Number         | VLAN ID (0 if no VLAN ID)                                       |
| subnet             | CIDR           | Subnet                                                          |
| provision_start_ip | IP             | First IP address to allow provisioning on                       |
| provision_end_ip   | IP             | Last IP address to allow provisioning on                        |
| nic_tag            | String         | Name of the nic tag that this logical network is over           |
| gateway            | IP             | Gateway IP address (Optional)                                   |
| resolvers          | Array of IPs   | Resolver IP addresses (Optional)                                |
| routes             | Routes Object  | Static routes for hosts on this network (Optional)              |
| owner_uuids        | Array of UUIDs | UFDS user UUIDs allowed to provision on this network (Optional) |
| description        | String         | Description (Optional)                                          |

**Notes:**

* The provisioning range of provision_start_ip to provision_end_ip is inclusive.
* Specifying owner_uuids for a network limits the owner_uuid of nics and IPs
  created on the network to those owner_uuids or the UFDS admin UUID.


### Routes object

The routes object is a JSON object where the keys are the IP or subnet
destinations, and the values are the gateways for those destinations. For
example:

    {
        "10.88.88.0/24": "10.99.99.7",
        "10.77.77.2": "10.99.99.254"
    }

This sets two static routes:

* subnet 10.88.88.0/24 through the gateway 10.99.99.7
* host 10.77.77.2 through the gateway 10.99.99.254


### Example

    POST /networks
        name=internal
        vlan_id=401
        subnet=10.0.2.0/24
        provision_start_ip=10.0.2.5
        provision_end_ip=10.0.2.250
        nic_tag=internal
        gateway=10.0.2.1
    {
      "uuid": "dcb499bd-1caf-4ff6-8d70-4e6d5c02dff3",
      "name": "internal",
      "vlan_id": 401,
      "family": "ipv4",
      "subnet": "10.0.2.0/24",
      "netmask": "255.255.255.0",
      "provision_start_ip": "10.0.2.5",
      "provision_end_ip": "10.0.2.250",
      "nic_tag": "internal",
      "resolvers": [],
      "gateway": "10.0.2.1"
    }


## UpdateNetwork (PUT /networks/:network_uuid)

Updates a logical network.

### Inputs

All fields are optional. At least one must be specified. Only the parameters
specified in the update are changed, leaving all others unchanged.

| Field              | Type           | Description                                                                       |
| ------------------ | -------------- | --------------------------------------------------------------------------------- |
| name               | String         | network name                                                                      |
| gateway            | IP             | Gateway IP address                                                                |
| provision_start_ip | IP             | First IP address to allow provisioning on                                         |
| provision_end_ip   | IP             | Last IP address to allow provisioning on                                          |
| resolvers          | Array of IPs   | Resolver IP addresses                                                             |
| routes             | Routes Object  | Static routes for hosts on this network (See the Routes Object description above) |
| owner_uuids        | Array of UUIDs | UFDS user UUIDs allowed to provision on this network                              |
| description        | String         | Description                                                                       |

**Notes:**

* The provisioning range of provision_start_ip to provision_end_ip is inclusive.
* Specifying owner_uuids for a network limits the owner_uuid of nics and IPs
  created on the network to those owner_uuids or the UFDS admin UUID.
* If one of the parameters causing a workflow to run is changed, the response
  will include a *job_uuid* field that can be used to obtain the job details
  from the workflow API.

### Example

    PUT /networks/2c670e67-bcd1-44c8-b59c-aaf7d8cfa17b
        description="Admin network"
        routes={ "10.88.88.0/24": "10.99.99.7" }

    {
      "uuid": "2c670e67-bcd1-44c8-b59c-aaf7d8cfa17b",
      "name": "admin",
      "vlan_id": 0,
      "family": "ipv4",
      "subnet": "10.99.99.0/24",
      "netmask": "255.255.255.0",
      "provision_start_ip": "10.99.99.37",
      "provision_end_ip": "10.99.99.253",
      "nic_tag": "admin",
      "resolvers": [
        "10.99.99.11"
      ],
      "routes": {
        "10.88.88.0/24": "10.99.99.7"
      },
      "owner_uuids": [
        "930896af-bf8c-48d4-885c-6573a94b1853"
      ],
      "description": "Admin network",
      "job_uuid": "fdeb7f1a-24ee-40a0-899f-736e68ffae39"
    }


## GetNetwork (GET /networks/:network_uuid)

Gets a logical network by UUID.

### Inputs

All fields are optional.

| Field            | Type | Description                                                         |
| ---------------- | ---- | ------------------------------------------------------------------- |
| provisionable_by | UUID | Check whether network is allowed to be provisioned by an owner UUID |

### Example

    GET /networks/dcb499bd-1caf-4ff6-8d70-4e6d5c02dff3
    {
      "uuid": "dcb499bd-1caf-4ff6-8d70-4e6d5c02dff3",
      "name": "internal",
      "vlan_id": 401,
      "family": "ipv4",
      "subnet": "10.0.2.0/24",
      "netmask": "255.255.255.0",
      "provision_start_ip": "10.0.2.5",
      "provision_end_ip": "10.0.2.250",
      "nic_tag": "internal",
      "resolvers": [],
      "gateway": "10.0.2.1"
    }


## DeleteNetwork (DELETE /networks/:network_uuid)

Deletes a network.

### Inputs

None.

### Returns

No response payload, only a "204 No Content" response status.


## ProvisionNic (POST /networks/:network_uuid/nics)

Creates a new NIC, provisioning an IP and MAC address in the process. The
`:network_uuid` can refer to a Network or a [Network Pool](#network-pools).

### Inputs

| Field             | Type                   | Description                                                                      |
| ----------------- | ---------------------- | -------------------------------------------------------------------------------- |
| owner_uuid        | UUID                   | Nic Owner                                                                        |
| cn_uuid           | UUID                   | The UUID of the CN this NIC is on (optional, unless on fabric)                  |
| belongs_to_uuid   | UUID                   | The UUID of what this Nic belongs to                                             |
| belongs_to_type   | String                 | The type that this belongs to (eg: 'zone', 'server')                             |
| ip                | String                 | IP address to assign to the nic                                                  |
| reserved          | Boolean                | Whether the IP address should be reserved                                        |
| nic_tags_provided | Array of nic tag names | Nic tags this nic provides                                                       |
| check_owner       | Boolean                | If set to false, skips network ownership checks (optional)                       |
| state             | String                 | Set state nic starts in (one of 'provisioning', 'stopped', 'running') (optional) |

**Notes:**

### Example

    POST /networks/1275886f-3fdf-456e-bba6-28e0e2eab58f/nics
        -d owner_uuid=930896af-bf8c-48d4-885c-6573a94b1853
        -d belongs_to_uuid=a112b8aa-eb39-4f84-8257-17a705880773
        -d belongs_to_type=zone

    {
      "ip": "10.99.99.240",
      "netmask": "255.255.255.0",
      "vlan_id": 0,
      "nic_tag": "admin",
      "mac": "90:b8:d0:f3:f8:8b",
      "primary": false,
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "belongs_to_uuid": "a112b8aa-eb39-4f84-8257-17a705880773",
      "belongs_to_type": "zone",
      "gateway": "10.99.99.7",
      "state": "running",
      "resolvers": [
        "8.8.4.4",
        "8.8.8.8"
      ]
    }



# IPs

These endpoints manage IPs on a logical network.

## ListIPs (GET /networks/:network_uuid/ips)

Gets all of the IPs in use on that Logical Network.

### Inputs

| Field            | Type            | Description                                                |
| ---------------- | --------------- | ---------------------------------------------------------- |
| belongs_to_type  | String          | The type that this belongs to (eg: 'zone', 'server')       |
| belongs_to_uuid  | UUID            | The UUID of what this IP belongs to                        |
| offset           | Integer         | Starting offset, see [Pagination](#pagination)             |
| limit            | Integer         | Maximum number of responses, see [Pagination](#pagination) |

### Example

    GET /networks/1275886f-3fdf-456e-bba6-28e0e2eab58f/ips

    [
      {
        "ip": "10.99.99.9",
        "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
        "belongs_to_uuid": "d66d8047-5c23-42a1-a26a-60ee806f7edb",
        "belongs_to_type": "zone",
        "netmask": "255.255.255.0",
        "gateway": "10.99.99.7",
        "nic": "c2:df:ef:11:48:48"
      },
      {
        "ip": "10.99.99.10",
        "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
        "belongs_to_uuid": "671819b2-5017-4337-8c85-e5658e632955",
        "belongs_to_type": "zone",
        "netmask": "255.255.255.0",
        "gateway": "10.99.99.7",
        "nic": "c2:e0:04:1e:c7:8a"
      }
    ]



## GetIP (GET /networks/:network_uuid/ips/:ip_address)

Gets a specific IP on a Logical Network.

### Example

    GET /networks/b330e2a1-6260-41a8-8567-a8a011f202f1/ips/10.88.88.106

    {
      "ip": "10.88.88.106",
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "belongs_to_uuid": "0e56fe34-39a3-42d5-86c7-d719487f892b",
      "belongs_to_type": "zone",
      "netmask": "255.255.255.0",
      "gateway": "10.88.88.2",
      "nic": "90:b8:d0:55:57:2f"
    }


## UpdateIP (PUT /networks/:network_uuid/ips/:ip_address)

Modifies a specific IP on a Logical Network.

### Inputs

| Field           | Type    | Description                                                                                         |
| --------------- | ------- | --------------------------------------------------------------------------------------------------- |
| owner_uuid      | UUID    | IP Owner                                                                                            |
| belongs_to_uuid | UUID    | The UUID of what this IP belongs to                                                                 |
| belongs_to_type | String  | The type that this belongs to (eg: 'zone', 'server')                                                |
| reserved        | Boolean | Whether the IP address should be reserved                                                           |
| unassign        | Boolean | When set, removes belongs_to_uuid and belongs_to_type, ignoring all other parameters in the request |
| check_owner     | Boolean | If set to false, skips network ownership checks (optional)                                          |

### Reserved IPs

Reserving an IP removes an IP address from the provisioning pool, which means
that IPs [provisioned on that network](#CreateNic) will not get that address.
Note that you can still provision a nic with this IP address, but you must
specify the IP when provisioning.

In addition, when you [delete a nic](#DeleteNic) with a reserved IP, the IP
**keeps its owner_uuid**, but its belongs_to_uuid and belongs_to_type are
removed (similar to the *unassign* option above).


### Example: reserving an IP

    PUT /networks/91daaada-4c62-4b80-9de8-0bd09895f86e/ips/10.99.99.77
        reserved=true

    {
      "ip": "10.99.99.77",
      "reserved": true,
      "free": false
    }



# Fabrics

## Overview

These endpoints manage fabrics.  Fabrics are per-owner overlay networks: each
account gets a fabric that's isolated from all other fabrics in the datacenter.
VMs in account can only connect to machines on their own fabric, but not the
fabrics of other users.

To use fabrics, users [create VLANs](#CreateFabricVLAN) on their fabric, and
then [create networks](#CreateFabricNetwork) on that VLAN.  See the
[Fabric VLANs](#fabric-vlans) and [Fabric Networks](#fabric-networks) sections
for API endpoints.

## Interaction with Portolan

For fabric networks to work, the packets from each fabric network (the overlay
network) are encapsulated by a Compute Node and sent over the underlay network
to other Compute Nodes.  In order to send a packet on an overlay network from
one Compute Node to another, we therefore need to lookup the following
pieces of data:

1. What Compute Node the destination MAC or IP address is on, and then
2. The IP address of that Compute Node on the underlay network

These lookups are handled by the
[portolan](https://github.com/joyent/sdc-portolan) service, which looks up the
data in [moray](https://github.com/joyent/moray) buckets.  NAPI populates these
tables.

To cover item #1 above, set the `cn_uuid` property when calling the
[CreateNic](#CreateNic) or [UpdateNic](#UpdateNic) endpoints.  This is
currently done by the provision workflow in
[VMAPI](https://github.com/joyent/sdc-vmapi), and kept up to date by
[net-agent](https://github.com/joyent/sdc-net-agent) on the Compute Node.

To cover item #2 above, set the `underlay` property on a server's vnic when
calling the [CreateNic](#CreateNic) or [UpdateNic](#UpdateNic) endpoints.


# Fabric VLANs

These endpoints manage a user's fabric VLANs.

## Fabric VLAN fields

All endpoints take an optional `fields` parameter, which is an array specifying
the properties that will be returned in the response body.  The properties
supported are:

- description
- name
- owner_uuid
- vlan_id
- vnet_id


## ListFabricVLANs (GET /fabrics/:owner_uuid/vlans)

List VLANs owned by a user.

### Inputs

| Field  | Type    | Description                                                |
| ------ | ------- | ---------------------------------------------------------- |
| offset | Integer | Starting offset, see [Pagination](#pagination)             |
| limit  | Integer | Maximum number of responses, see [Pagination](#pagination) |

### Example

    GET /fabrics/2ee96b00-2bd6-4eda-9fc1-84b56a1059ad/vlans

    [
      {
        "name": "default",
        "owner_uuid": "2ee96b00-2bd6-4eda-9fc1-84b56a1059ad",
        "vlan_id": 2,
        "vnet_id": 3688662
      }
    ]


## CreateFabricVLAN (POST /fabrics/:owner_uuid/vlans)

Create a new fabric VLAN.

### Inputs

| Field              | Type             | Description                                                                            |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------- |
| name               | String           | VLAN name                                                                              |
| description        | String           | VLAN description (Optional)                                                            |
| fields             | Array of Strings | Properties to return - see [Fields](#fabric-vlan-fields) above for the list (Optional) |
| vlan_id            | Number           | VLAN ID (0 if no VLAN ID)                                                              |

### Example

    POST /fabrics/cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11/vlans
        vlan_id=44
        name=production

    {
      "name": "production",
      "owner_uuid": "cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11",
      "vlan_id": 44,
      "vnet_id": 7757106
    }

The `vnet_id` property is unique to an `owner_uuid` - each account has their
own unique ID that's shared by all of their Fabric VLANs and networks.

## GetFabricVLAN (GET /fabrics/:owner_uuid/vlans/:vlan_id)

Get a VLAN by its VLAN ID.

### Inputs

All inputs are optional.

| Field              | Type             | Description                                                                 |
| ------------------ | ---------------- | --------------------------------------------------------------------------- |
| fields             | Array of Strings | Properties to return - see [Fields](#fabric-vlan-fields) above for the list |

### Example

    GET /fabrics/cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11/vlans/44

    {
      "name": "production",
      "owner_uuid": "cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11",
      "vlan_id": 44,
      "vnet_id": 7757106
    }

## UpdateFabricVLAN (PUT /fabrics/:owner_uuid/vlans/:vlan_id)

Update a fabric VLAN.

### Inputs

All inputs are optional.

| Field              | Type             | Description                                                                 |
| ------------------ | ---------------- | --------------------------------------------------------------------------- |
| name               | String           | VLAN name                                                                   |
| description        | String           | VLAN description                                                            |
| fields             | Array of Strings | Properties to return - see [Fields](#fabric-vlan-fields) above for the list |

### Example

    PUT /fabrics/cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11/vlans/44
        name=qa

    {
      "name": "qa",
      "owner_uuid": "cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11",
      "vlan_id": 44,
      "vnet_id": 7757106
    }


## DeleteFabricVLAN (DELETE /fabrics/:owner_uuid/vlans/:vlan_id)

Delete a fabric VLAN.

### Example

    DELETE /fabrics/cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11/vlans/44

    {}


# Fabric Networks

These endpoints manage a user's fabric networks.

## Fabric Network fields

All endpoints take an optional `fields` parameter, which is an array specifying
the properties that will be returned in the response body.  The properties
supported are:

- description
- fabric
- gateway
- internet_nat
- mtu
- name
- nic_tag
- owner_uuid
- owner_uuids
- provision_end_ip
- provision_start_ip
- resolvers
- routes
- subnet
- uuid
- vlan_id

## ListFabricNetworks (GET /fabrics/:owner_uuid/vlans/:vlan_id/networks)

List a user's networks on a VLAN.

### Inputs

All parameters are optional.

| Field              | Type             | Description                                                                               |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| fields             | Array of Strings | Properties to return - see [Fields](#fabric-network-fields) above for the list (Optional) |

### Example

    GET /fabrics/2ee96b00-2bd6-4eda-9fc1-84b56a1059ad/vlans/44

    [
      {
        "mtu": 1400,
        "nic_tag": "sdc_overlay",
        "name": "web",
        "provision_end_ip": "10.0.1.254",
        "provision_start_ip": "10.0.1.2",
        "vlan_id": 44,
        "family": "ipv4",
        "subnet": "10.0.1.0/24",
        "uuid": "4944e6d9-d3ee-462c-b5a6-1c953551ffcf",
        "fabric": true,
        "vnet_id": 7757106,
        "gateway_provisioned": false,
        "resolvers": [
          "8.8.8.8"
        ],
        "gateway": "10.0.1.1",
        "owner_uuid": "cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11",
        "netmask": "255.255.255.0"
      }
    ]


## CreateFabricNetwork (POST /fabrics/:owner_uuid/vlans/:vlan_id/networks)

Create a new fabric network on a VLAN.

### Inputs

The parameters to this endpoint are the same as to [CreateNetwork](#CreateNetwork),
but with some fields removed:

| Field              | Type             | Description                                                                               |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| name               | String           | Network name                                                                              |
| vlan_id            | Number           | Network ID                                                                                |
| subnet             | CIDR             | Subnet                                                                                    |
| provision_start_ip | IP               | First IP address to allow provisioning on                                                 |
| provision_end_ip   | IP               | Last IP address to allow provisioning on                                                  |
| gateway            | IP               | Gateway IP address (Optional)                                                             |
| internet_nat       | Boolean          | Provision a NAT zone on the gateway address (Optional) (default: true)                    |
| resolvers          | Array of IPs     | Resolver IP addresses (Optional)                                                          |
| routes             | Routes Object    | Static routes for hosts on this network (Optional)                                        |
| description        | String           | Description (Optional)                                                                    |
| fields             | Array of Strings | Properties to return - see [Fields](#fabric-network-fields) above for the list (Optional) |


### Example

    POST /fabrics/cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11/vlans/44/networks
        name=web
        subnet=10.0.1.0/24
        provision_start_ip=10.0.1.2
        provision_end_ip=10.0.1.254
        gateway=10.0.1.1
        resolvers=8.8.8.8

    {
      "mtu": 1400,
      "nic_tag": "sdc_overlay",
      "name": "web",
      "provision_end_ip": "10.0.1.254",
      "provision_start_ip": "10.0.1.2",
      "vlan_id": 44,
      "family": "ipv4",
      "subnet": "10.0.1.0/24",
      "uuid": "4944e6d9-d3ee-462c-b5a6-1c953551ffcf",
      "fabric": true,
      "vnet_id": 7757106,
      "gateway_provisioned": false,
      "resolvers": [
        "8.8.8.8"
      ],
      "gateway": "10.0.1.1",
      "owner_uuid": "cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11",
      "netmask": "255.255.255.0"
    }


There are several read-only properties of the network:

- `fabric`: Always set to `true`
- `gateway_provisioned`: If there is a gateway for this network, and a NAT zone
  has not been provisioned, this will be set to `false`.
- `mtu`: Taken from `fabric_cfg.default_overlay_mtu` in the SDC SAPI config.
- `netmask`: derived from subnet
- `nic_tag`: Set to `overlay.overlayNicTag` in the NAPI config.
- `owner_uuid`: the owner of the fabric
- `vnet_id`: per-owner virtual network ID - see [Fabric VLANs](#fabric-vlans)
  above.


## GetFabricNetwork (GET /fabrics/:owner_uuid/vlans/:vlan_id/networks/:network_uuid)

Get a Network by its Network ID.

### Inputs

All parameters are optional.

| Field              | Type             | Description                                                                               |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| fields             | Array of Strings | Properties to return - see [Fields](#fabric-network-fields) above for the list (Optional) |

### Example

    GET /fabrics/cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11/vlans/44/networks/4944e6d9-d3ee-462c-b5a6-1c953551ffcf

    {
      "mtu": 1400,
      "nic_tag": "sdc_overlay",
      "name": "web",
      "provision_end_ip": "10.0.1.254",
      "provision_start_ip": "10.0.1.2",
      "vlan_id": 44,
      "family": "ipv4",
      "subnet": "10.0.1.0/24",
      "uuid": "4944e6d9-d3ee-462c-b5a6-1c953551ffcf",
      "fabric": true,
      "vnet_id": 7757106,
      "gateway_provisioned": false,
      "resolvers": [
        "8.8.8.8"
      ],
      "gateway": "10.0.1.1",
      "owner_uuid": "cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11",
      "netmask": "255.255.255.0"
    }

## DeleteFabricNetwork (DELETE /fabrics/:owner_uuid/vlans/:vlan_id/networks/:network_uuid)

Delete a fabric network.

### Example

    DELETE /fabrics/cd1cc2a9-e6ad-4c1c-a6bc-acd14e0d4d11/vlans/44/networks/4944e6d9-d3ee-462c-b5a6-1c953551ffcf

    {}



# Nics

These endpoints manage nics.

## ListNics (GET /nics)

Returns a list of all nics.

### Inputs

All parameters are optional filters on the list. A nic is output in the list
if it matches *all* of the input parameters.

| Field             | Type                   | Description                                                |
| ----------------- | ---------------------- | ---------------------------------------------------------- |
| owner_uuid        | UUID                   | Nic Owner                                                  |
| belongs_to_uuid   | UUID                   | The UUID of what this Nic belongs to                       |
| belongs_to_type   | String                 | The type that this belongs to (eg: 'zone', 'server')       |
| network_uuid      | String                 | The UUID of the network the NIC is on                      |
| nic_tag           | String                 | The nic tag that this nic is on                            |
| nic_tags_provided | Array of nic tag names | Nic tags provided by the nic                               |
| offset            | Integer                | Starting offset, see [Pagination](#pagination)             |
| limit             | Integer                | Maximum number of responses, see [Pagination](#pagination) |

Note: all filter fields above can have multiple comma-separated values to search
on (like a logical OR), excepting `offset` and `limit`.

### Example: list all nics

    GET /nics

    [
      {
        "ip": "10.88.88.190",
        "netmask": "255.255.255.0",
        "vlan_id": 0,
        "nic_tag": "external",
        "mac": "90:b8:d0:b6:a2:86",
        "primary": false,
        "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
        "belongs_to_uuid": "27391a96-9fb5-4896-975a-85f948d9c509",
        "belongs_to_type": "zone",
        "gateway": "10.88.88.2",
        "state": "running",
        "resolvers": [
          "8.8.4.4",
          "8.8.8.8"
        ]
      },
      {
        "ip": "10.88.88.220",
        "netmask": "255.255.255.0",
        "vlan_id": 0,
        "nic_tag": "external",
        "mac": "90:b8:d0:bb:28:8b",
        "primary": false,
        "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
        "belongs_to_uuid": "27391a96-9fb5-4896-975a-85f948d9c509",
        "belongs_to_type": "zone",
        "gateway": "10.88.88.2",
        "state": "running",
        "resolvers": [
          "8.8.4.4",
          "8.8.8.8"
        ]
      },
      ...
    ]


### Example: list all nics with a nic tag of external or admin

    GET /nics?nic_tag=external,admin

    [
      {
        "mac": "c2:e0:09:bb:a5:3b",
        "primary": false,
        "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
        "belongs_to_uuid": "0e56fe34-39a3-42d5-86c7-d719487f892b",
        "belongs_to_type": "zone",
        "ip": "10.99.99.19",
        "netmask": "255.255.255.0",
        "vlan_id": 0,
        "nic_tag": "admin",
        "gateway": "10.99.99.7",
        "state": "running",
        "resolvers": [
          "8.8.8.8",
          "8.8.4.4"
        ]
      },
      {
        "mac": "90:b8:d0:b0:e6:d0",
        "primary": false,
        "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
        "belongs_to_uuid": "7896fd2d-0b6b-4e96-9e92-c3c7247bfe71",
        "belongs_to_type": "zone",
        "ip": "10.88.88.120",
        "netmask": "255.255.255.0",
        "vlan_id": 0,
        "nic_tag": "external",
        "gateway": "10.88.88.2",
        "state": "running",
        "resolvers": [
          "8.8.8.8",
          "8.8.4.4"
        ]
      },
      ...
    ]


### Example: list all nics belonging to servers that provide an admin or external nic tag

    GET /nics?belongs_to_type=server&nic_tags_provided=admin,external | json -Hamac nic_tags_provided

    00:50:56:3d:a7:95 [
      "external"
    ]
    00:50:56:34:60:4c [
      "admin"
    ]



## CreateNic (POST /nics)

Creates a new nic.

| Field                    | Type                   | Description                                                                       |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------- |
| mac                      | String                 | MAC address                                                                       |
| owner_uuid               | UUID                   | Nic Owner                                                                         |
| belongs_to_uuid          | UUID                   | The UUID of what this Nic belongs to                                              |
| belongs_to_type          | String                 | The type that this belongs to (eg: 'zone', 'server')                              |
| cn_uuid                  | UUID                   | The UUID of the CN this NIC is on (optional, unless on fabric)                    |
| ip                       | String                 | IP address to assign to the nic                                                   |
| network_uuid             | UUID                   | UUID of the network or network pool to provision an IP on                         |
| nic_tag                  | String                 | Nic tag (required if IP specified)                                                |
| vlan_id                  | Number                 | VLAN ID (required if IP specified)                                                |
| primary                  | Boolean                | Whether this is the VM's primary nic (optional, default false)                    |
| reserved                 | Boolean                | Whether the IP address should be reserved                                         |
| nic_tags_provided        | Array of nic tag names | Nic tags this nic provides                                                        |
| model                    | String                 | Nic model for KVM VMs (optional for other VM types)                               |
| check_owner              | Boolean                | If set to false, skips network ownership checks (optional)                        |
| state                    | String                 | Set state nic starts in (one of 'provisioning', 'stopped', 'running') (optional)  |
| allow_dhcp_spoofing      | Boolean                | Allow operating a DHCP server on this nic                                         |
| allow_ip_spoofing        | Boolean                | Allow sending and receiving packets that don't match the nic's IP                 |
| allow_mac_spoofing       | Boolean                | Allow sending and receiving packets that don't match the nic's MAC address        |
| allow_restricted_traffic | Boolean                | Allow sending restricted network traffic (packets that are not IPv4, IPv6 or ARP) |
| allow_unfiltered_promisc | Boolean                | Allow this VM to have multiple MAC addresses                                      |
| underlay                 | Boolean                | Indicates this vnic is to be used as a server's underlay nic (optional)           |

A VM can only have one primary NIC, and  will set its default gateway and
nameservers to the values obtained from the network attached to the primary NIC.
Adding a new primary NIC will remove the `primary` flag from the old one.


### Example

    POST /nics
        -d mac=00:50:56:34:60:4c
        -d owner_uuid=930896af-bf8c-48d4-885c-6573a94b1853
        -d belongs_to_uuid=564da1dd-cea7-9cc6-1059-cca75970c802
        -d belongs_to_type=server
    {
      "mac": "00:50:56:34:60:4c",
      "primary": false,
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "belongs_to_uuid": "564da1dd-cea7-9cc6-1059-cca75970c802",
      "belongs_to_type": "server"
    }


## GetNic (GET /nics/:mac_address)

Returns the nic with the given MAC address.

**Note: this is the MAC address with all colons removed.**

### Example

    GET /nics/90b8d0575370

    {
      "ip": "10.88.88.198",
      "netmask": "255.255.255.0",
      "vlan_id": 0,
      "nic_tag": "external",
      "mac": "90:b8:d0:57:53:70",
      "primary": false,
      "owner_uuid": "aaaaaaaf-bf8c-48d4-885c-6573a94b1853",
      "belongs_to_uuid": "27391a96-bbbb-bbbb-bbbb-85f948d9c509",
      "belongs_to_type": "zone",
      "gateway": "10.88.88.2",
      "state": "running",
      "resolvers": [
        "8.8.4.4",
        "8.8.8.8"
      ],
      "created_timestamp": "2017-04-01T01:02:03.456Z",
      "modified_timestamp": "2017-05-12T11:22:33.777Z"
    }

The meaning of the fields are the same as in the CreateNic call.

NOTE: The created and modified timestamps are read-only.  They may also
return "1970-01-01T00:00:00.000Z" (epoch) if the creation or last modification
of the nic occurred prior to NAPI implementing support for the timestamps.

## UpdateNic (PUT /nics/:mac_address)

Changes properties of the nic with the given MAC address.

| Field                    | Type                   | Description                                                                       |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------- |
| owner_uuid               | UUID                   | Nic Owner                                                                         |
| belongs_to_uuid          | UUID                   | The UUID of what this Nic belongs to                                              |
| belongs_to_type          | String                 | The type that this belongs to (eg: 'zone', 'server')                              |
| cn_uuid                  | UUID                   | The UUID of the Compute Node a VM's nic is provisioned on (optional)              |
| ip                       | String                 | IP address to assign to the nic                                                   |
| network_uuid             | UUID                   | The network UUID the nic's IP should be on                                        |
| primary                  | Boolean                | Whether this is the VM's primary nic                                              |
| nic_tags_provided        | Array of nic tag names | Nic tags this nic provides                                                        |
| model                    | String                 | Nic model for KVM VMs (optional for other VM types)                               |
| check_owner              | Boolean                | If set to false, skips network ownership checks (optional)                        |
| allow_dhcp_spoofing      | Boolean                | Allow operating a DHCP server on this nic                                         |
| allow_ip_spoofing        | Boolean                | Allow sending and receiving packets that don't match the nic's IP                 |
| allow_mac_spoofing       | Boolean                | Allow sending and receiving packets that don't match the nic's MAC address        |
| allow_restricted_traffic | Boolean                | Allow sending restricted network traffic (packets that are not IPv4, IPv6 or ARP) |
| allow_unfiltered_promisc | Boolean                | Allow this VM to have multiple MAC addresses                                      |
| underlay                 | Boolean                | Indicates this vnic is to be used as a server's underlay nic (optional)           |


**Note: this is the MAC address with all colons removed.**

### Example

    PUT /nics/90b8d0575370
        -d belongs_to_uuid=27391a96-bbbb-bbbb-bbbb-888888888888
        -d belongs_to_type=server
        -d state=stopped

    {
      "ip": "10.88.88.198",
      "netmask": "255.255.255.0",
      "vlan_id": 0,
      "nic_tag": "external",
      "mac": "90:b8:d0:57:53:70",
      "primary": false,
      "owner_uuid": "aaaaaaaf-bf8c-48d4-885c-6573a94b1853",
      "belongs_to_uuid": "27391a96-bbbb-bbbb-bbbb-888888888888",
      "belongs_to_type": "server",
      "gateway": "10.88.88.2",
      "state": "stopped",
      "resolvers": [
        "8.8.4.4",
        "8.8.8.8"
      ]
    }


## DeleteNic (DELETE /nics/:mac_address)

Deletes the nic with the given MAC address, freeing any IPs that belong to
that nic in the process. If the IP address is reserved, its reserved and
owner_uuid properties will be preserved.

**Note: this is the MAC address with all colons removed.**

### Inputs

None.

### Returns

No response payload, only a "204 No Content" response status.



# Network Pools

These endpoints manage logical network provisioning pools.  These are
collections of logical networks that can be used when
[provisioning a nic](#CreateNic). The ordering of the networks property
of a pool is significant: NAPI will go try to provision an IP on each network
in this list in succession, until it succeeds or runs out of networks.


## ListNetworkPools (GET /network_pools)

Returns a list of all logical network pools.

### Inputs

All parameters are optional filters on the list. A network pool will be listed
if it matches *all* of the input parameters.

| Field            | Type           | Description                                                                              |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------- |
| name             | String         | Return network pools that match the pool name                                            |
| family           | String         | Return network pools containing networks of the given family (one of 'ipv4' or 'ipv6')   |
| networks         | Array of UUIDs | Return network pools that contain the given network UUID (only one can be given for now) |
| provisionable_by | UUID           | Return network pools that are provisionable by this owner_uuid                           |
| offset           | Integer        | Starting offset, see [Pagination](#pagination)                                           |
| limit            | Integer        | Maximum number of responses, see [Pagination](#pagination)                               |

### Example

    GET /network_pools
    [
      {
        "uuid": "3b5913ec-42e6-4803-9c0b-c9b1c5603520",
        "name": "internal networks",
        "nic_tag": "internal",
        "family": "ipv4",
        "networks": [
          "0e70de36-a40b-4ac0-9429-819f5ff822bd",
          "9f2eada0-529b-4673-a377-c249f9240a12"
        ]
      },
      {
        "uuid": "e967a42b-312d-490c-b753-c4768d9f2091",
        "name": "external v6 networks",
        "description": "Logical pool of public IPv6 addresses",
        "nic_tag": "external",
        "family": "ipv6",
        "networks": [
          "57a83e2b-527c-41c1-983c-be9b792011dc",
          "8ba8a35f-3eb3-496b-8103-8238eb40f9d0"
        ]
      }
    ]


## CreateNetworkPool (POST /network_pools)

Creates a new logical network provisioning pool.

### Inputs

| Field       | Type           | Description                                                          |
| ----------- | -------------- | -------------------------------------------------------------------- |
| name        | String         | Network provisioning pool name                                       |
| description | String         | Description of the new network pool                                  |
| networks    | Array of UUIDs | Logical Network UUIDs                                                |
| owner_uuids | Array of UUIDs | UFDS user UUIDs allowed to provision on this network pool (Optional) |

**Notes:**

* Specifying owner_uuids for a pool limits the networks in that pool to those
  with either no owner_uuid or matching one of the owner_uuids. You can
  therefore only provision nics or IPs on a network in the pool according to
  its [owner_uuid limitations](#CreateNetwork).

### Example

    POST /network_pools
        name=internal%20networks
        networks=0e70de36-a40b-4ac0-9429-819f5ff822bd,9f2eada0-529b-4673-a377-c249f9240a12
    {
      "uuid": "3b5913ec-42e6-4803-9c0b-c9b1c5603520",
      "name": "internal networks",
      "nic_tag": "internal",
      "family": "ipv4",
      "networks": [
        "0e70de36-a40b-4ac0-9429-819f5ff822bd",
        "9f2eada0-529b-4673-a377-c249f9240a12"
      ]
    }


## GetNetworkPool (GET /network_pools/:uuid)

Gets a logical network provisioning pool by UUID.

### Example

    GET /network_pools/3b5913ec-42e6-4803-9c0b-c9b1c5603520
    {
      "uuid": "3b5913ec-42e6-4803-9c0b-c9b1c5603520",
      "name": "internal networks",
      "nic_tag": "internal",
      "family": "ipv4",
      "networks": [
        "0e70de36-a40b-4ac0-9429-819f5ff822bd",
        "9f2eada0-529b-4673-a377-c249f9240a12"
      ]
    }


## UpdateNetworkPool (PUT /network_pools/:uuid)

Changes a logical network provisioning pool.

### Inputs

Must specify at least one of:

| Field       | Type           | Description                                                          |
| ----------- | -------------- | -------------------------------------------------------------------- |
| name        | String         | Network provisioning pool name                                       |
| description | String         | Description of the new network pool                                  |
| networks    | Array of UUIDs | Logical Network UUIDs                                                |
| owner_uuids | Array of UUIDs | UFDS user UUIDs allowed to provision on this network pool            |

### Example

    PUT /network_pools/3b5913ec-42e6-4803-9c0b-c9b1c5603520
        name=internal-pool
    {
      "uuid": "3b5913ec-42e6-4803-9c0b-c9b1c5603520",
      "name": "internal-pool",
      "nic_tag": "internal",
      "family": "ipv4",
      "networks": [
        "0e70de36-a40b-4ac0-9429-819f5ff822bd",
        "9f2eada0-529b-4673-a377-c249f9240a12"
      ]
    }


## DeleteNetworkPool (DELETE /network_pools/:uuid)

Deletes a network pool.

### Inputs

None.

### Returns

No response payload, only a "204 No Content" response status.



# Search

These endpoints are for searching the various components of NAPI.


## SearchIPs (GET /search/ips)

Searches IPs across all logical networks.


### Inputs

| Field | Type       | Description                         |
| ----- | ---------- | ----------------------------------- |
| ip    | IP address | IP address to search for (required) |

The following are optional inputs which may be used to filter the search:

| Field           | Type    | Description                                          |
| --------------- | ------- | ---------------------------------------------------- |
| belongs_to_type | String  | The type that this belongs to (eg: 'zone', 'server') |
| belongs_to_uuid | UUID    | The UUID of what this IP belongs to                  |
| fabric          | Boolean | Whether the network is on a fabric or not            |
| owner_uuid      | UUID    | Returns IPs owned by the specified uuid              |

### Example

    GET /search/ips?ip=10.77.77.1
    [
      {
        "ip": "10.77.77.1",
        "reserved": false,
        "free": false,
        "belongs_to_type": "zone",
        "belongs_to_uuid": "807223ae-bcc7-11e2-841a-3bf662b0a0c3",
        "owner_uuid": "8d40ace0-bcc7-11e2-9bae-575fff7de171",
        "network_uuid": "1d0dd3de-1d8b-4f31-a58a-284eb2d9335f"
      },
      {
        "ip": "10.77.77.1",
        "reserved": false,
        "free": true,
        "network_uuid": "210ed836-737a-4dfe-97f9-a9f5f6811581"
      }
    ]



# Link Aggregations

These endpoints manage link aggregations.


## ListAggregations (GET /aggregations)

Returns a list of aggregations, optionally filtered by parameters.

### Inputs

All parameters are optional filters on the list.

| Field             | Type                   | Description                                                |
| ----------------- | ---------------------- | ---------------------------------------------------------- |
| belongs_to_uuid   | UUID                   | The UUID of the Compute Node the aggregation belongs to    |
| macs              | Array of MAC addresses | MAC addresses of nics in the aggregation                   |
| nic_tags_provided | Array of nic tag names | Nic tags provided by the nic                               |
| offset            | Integer                | Starting offset, see [Pagination](#pagination)             |
| limit             | Integer                | Maximum number of responses, see [Pagination](#pagination) |

### Example

    GET /aggregations
    [
        {
          "belongs_to_uuid": "564d4d2c-ddd0-7be7-40ae-bae473a1d53e",
          "id": "564d4d2c-ddd0-7be7-40ae-bae473a1d53e-aggr0",
          "lacp_mode": "active",
          "name": "aggr0",
          "macs": [
            "00:0c:29:a1:d5:48",
            "00:0c:29:a1:d5:52"
          ],
          "nic_tags_provided": [
            "admin",
            "internal"
          ]
        }
    ]


## GetAggregation (GET /aggregations/:id)

Returns an aggregation.

### Example

    GET /aggregations/564d4d2c-ddd0-7be7-40ae-bae473a1d53e-aggr0
    {
      "belongs_to_uuid": "564d4d2c-ddd0-7be7-40ae-bae473a1d53e",
      "id": "564d4d2c-ddd0-7be7-40ae-bae473a1d53e-aggr0",
      "lacp_mode": "active",
      "name": "aggr0",
      "macs": [
        "00:0c:29:a1:d5:48",
        "00:0c:29:a1:d5:52"
      ],
      "nic_tags_provided": [
        "admin",
        "internal"
      ]
    }


## CreateAggregation (POST /aggregations)

Creates an aggregation.

### Inputs

| Field             | Type                   | Description                                                                            |
| ----------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| name              | String                 | aggregation name (**required**)                                                        |
| lacp_mode         | String                 | aggregation LACP mode: can be active, passive or off (default: off)                    |
| macs              | Array of Strings       | MAC addresses of links in the aggregation (**required**)                               |
| nic_tags_provided | Array of nic tag names | nic tags that this aggregation provides (same parameter as in [CreateNic](#CreateNic)) |

### Example

    POST /aggregations
        name=aggr0
        macs=00:0c:29:a1:d5:48,00:0c:29:a1:d5:52
        lacp_mode=active
        nic_tags_provided=admin,internal

    {
      "belongs_to_uuid": "564d4d2c-ddd0-7be7-40ae-bae473a1d53e",
      "id": "564d4d2c-ddd0-7be7-40ae-bae473a1d53e-aggr0",
      "lacp_mode": "active",
      "name": "aggr0",
      "macs": [
        "00:0c:29:a1:d5:48",
        "00:0c:29:a1:d5:52"
      ],
      "nic_tags_provided": [
        "admin",
        "internal"
      ]
    }


## UpdateAggregation (PUT /aggregations/:id)

Updates an aggregation.

### Inputs

| Field             | Type                   | Description                                                                            |
| ----------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| lacp_mode         | String                 | aggregation LACP mode: can be active, passive or off (default: off)                    |
| macs              | Array of Strings       | MAC addresses of links in the aggregation                                              |
| nic_tags_provided | Array of nic tag names | nic tags that this aggregation provides (same parameter as in [CreateNic](#CreateNic)) |

### Example

    PUT /aggregations/564d4d2c-ddd0-7be7-40ae-bae473a1d53e-aggr0
        lacp_mode=off

    {
      "belongs_to_uuid": "564d4d2c-ddd0-7be7-40ae-bae473a1d53e",
      "id": "564d4d2c-ddd0-7be7-40ae-bae473a1d53e-aggr0",
      "lacp_mode": "off",
      "name": "aggr0",
      "macs": [
        "00:0c:29:a1:d5:48",
        "00:0c:29:a1:d5:52"
      ],
      "nic_tags_provided": [
        "admin",
        "internal"
      ]
    }


## DeleteAggregation (DELETE /aggregations/:id)

Deletes an aggregation.

### Inputs

None.

### Example

    DELETE /aggregations/564d4d2c-ddd0-7be7-40ae-bae473a1d53e-aggr0
    { }


### Returns

No response payload, only a "204 No Content" response status.


## Enabling on a Compute Node

To link aggregation for a compute node, you must perform the following steps:

* Create a link aggregation with the *macs* property set to MAC addresses of
  nics on that Compute Node
* Reboot the Compute Node

Before rebooting the Compute Node, you can confirm that it will get the
correct bootparams on its next boot by using the "booter" command in the
dhcpd zone, like so:

    booter bootparams 00:0c:29:a1:d5:3e | json kernel_args | grep -v rabbit
    {
      "hostname": "00-0c-29-a1-d5-3e",
      "admin_nic": "00:0c:29:a1:d5:3e",
      "internal_nic": "aggr0",
      "aggr0_aggr": "\"00:0c:29:a1:d5:48,00:0c:29:a1:d5:52\"",
      "aggr0_lacp_mode": "off"
    }

In the example above, the node will boot with one aggregation, aggr0, with
2 physical nics in the aggregation.

**Note: changes to aggregations will only take effect at the next reboot
of the Compute Node that hosts them.**


# Pagination

Each of the list endpoints is a paginated resource, i.e.:

* [ListNicTags](#ListNicTags),
* [ListNetworks](#ListNetworks)
* [ListIPs](#ListIPs),
* [ListFabricVLANs](#ListFabricVLANs)
* [ListFabricNetworks](#ListFabricNetworks),
* [ListNics](#ListNics)
* [ListNetworkPools](#ListNetworkPools)
* [ListAggregations](#ListAggregations)

Being paginated means that not all queries will be provided in a single call to
these APIs. To control the pagination there are two different query parameters
which may be specified:

* `limit`
* `offset`

The `limit` property controls how many entries will be retrieved in a single
request. By default, if `limit` is not specified, then the default limit, 1000
entries, will be returned. `limit` may range between 1 and 1000, inclusive.

The `offset` property controls which entry the query should start with. By
default, if `offset` is not specified, then the default offset used is 0.

These primitives may be combined to obtain all of the results. For example, if
there are 2300 networks, then to obtain all of them, one would make the three
following calls to [ListNetworks](#ListNetworks):

```
GET /networks
GET /networks?offset=1000
GET /networks?offset=2000
```

The general rule of thumb is that if you get a number of entries equal to your
`limit`, then you should make another query, adding the `limit` amount to the
`offset`. Once a number of entries less than `limit` has been returned, then
there is no more need to call the API.

If an invalid limit or offset is specified, then a 400-series error will
be generated with a detailed message describing the error.

# Changelog

## 2012-07-04

- Can now pass `reserved` to [CreateNic](#CreateNic) and
  ProvisionNic(#ProvisionNic)
- [UpdateIP](#UpdateIP) can now change the IP's `reserved` property

## 2012-08-20

- `gateway` and `netmask` properties no longer required when calling
  [CreateNic](#CreateNic) with an IP address
- Adding and updating nics now takes an optional `nic_tags_provided` parameter

## 2012-09-12

- [ListNetworks](#ListNetworks): added `vlan_id` and `nic_tag` filters

## 2013-02-07

- Added [network pool](#network-pools) endpoints

## 2013-04-17

- Added network `owner_uuid` parameter
- Added `provisionable_by` parameter to [ListNetworks](#ListNetworks) endpoint

## 2013-05-01

- Changed network and network pool `owner_uuid` parameter to `owner_uuids`

## 2013-05-14

- Added [SearchIPs](#SearchIPs) endpoint
- Added [UpdateNetwork](#UpdateNetwork) endpoint

## 2014-02-18

- Added [link aggregations](#link-aggregations) endpoints

## 2015-03-17

- Nic tag endpoints now support the `mtu` property

## 2015-03-31

- Added [fabric VLANs](#fabric-vlans) and [fabric networks](#fabric-networks)
  endpoints
- [CreateNic](#CreateNic) and [UpdateNic](#UpdateNic) endpoints now support the
  `cn_uuid` and `underlay` properties.

## 2015-05-01

- [Fabric Networks](#fabric-networks) endpoints now support the `fields`
  property.
- [Fabric VLANs](#fabric-vlans) endpoints now support the `description` and
  `fields` properties.

## 2015-05-07

- [ListNetworks](#ListNetworks) now supports filtering by the `fabric`
  property.  Filtering by `owner_uuid` now returns only networks owned by that
  owner, rather than having identical behaviour to the `provisionable_by`
  filter.

## 2015-06-30

- All list endpoints now support the `limit` and `offset` properties to enable
  pagination of results. See [Pagination](#Pagination) for more
  information.
- The list endpoints are now strict about checking for unknown query
  parameters and will respond with an error about unknown query parameters if
  encountered.
- [ListNics](#ListNics) now supports filtering on the `network_uuid` property.
- [ListNetworks](#ListNetworks) now supports `name` and `nic_tag` being arrays.
- [ListNetworkPools](#ListNetworkPools) now supports filtering on the `name`
  property.
- [ListIPs](#ListIPs) now supports filtering on the `belongs_to_uuid`
  and `belongs_to_type` properties.
