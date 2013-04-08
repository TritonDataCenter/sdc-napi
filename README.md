# Objective

The IP management service:

* has to allow IP's to have owners
* has to allow reserving an IP address
* should make IP addresses "commentable" / have history so there can be an audit trail
* should make it possible to provision a machine with a particular IP address (this can be two step (reserve then use)
* has to make it possible for logical networks to have owners (default owner is admin)
* has to create audit records of IP addresses and Logical Networks
* will provide the ability to create and manage logical networks
* will provide the ability to create and manage "other" types of networks (ie keep in mind we'll do VL2 / OpenFlow / etc)
* will need to do lazy creation (esp with IPv6 subnets)
* provide the ability to create and manage network pools (groups of logical networks). (it's unclear whether or not pools need owners)
* will need to manage nic tags (maybe) (it must be possible to add a nic tag to
  a machine without a reboot)


# /ips

## States

IPs can have the following states:

* *free* - not in use - available for provisioning
* *reserved* - not available for provisioning (might be in use for something else, eg: at the start / end of a subnet)
* *provisioning* - IP has been reserved for provisioning, but has not yet been committed
    * This could also be used for IPs in the deprovisioning state
* *provisioned* - IP is in use


The state machine for this would be:

                      +----------+                 +------------------+
                      | free for |<--------------->| reserved for use |
              +-------+   use    |<-------+        |  outside of SDC  |
              |       +----------+        |        +------------------+
              |                           |
              |                           |
              v                           |
    +--------------------+      +---------+----------+
    |    provisioned     |      | deprovisioning but |
    | but not active yet |      |    still active    |
    +---------+----------+      +--------------------+
              |                           ^
              |                           |
              |                           |
              |      +-------------+      |
              |      | in use by a |      |
              +----->|    SM /VM   +------+
                     +-------------+

## Endpoints

Get information about an IP:

    GET /ips/1.2.3.4
    {
      "ipv4_address": "1.2.3.4",
      "owner_uuid": "<customer UUID>",
      "belongs_to": "<zone UUID>",
      "status": "provisioned",
      "comment": "best customer ever",
      "nic": "/nics/c4:2c:03:3a:fa:8e"
    }

(Comment field is included in all endpoints)


With all parameters necessary for provisioning:

    GET /ips/1.2.3.4
      -d list=provision
    {
      "ipv4_address": "1.2.3.4",
      "owner_uuid": "<customer UUID>",
      "belongs_to": "<zone UUID>
      "vlan": 62,
      "network": "/networks/<uuid>",
      "nic": "c4:2c:03:3a:fa:8e",
      "nic_tag": "external"
    }


Get an IPv6 address:

    GET /ips/fe80::c62c:3ff:fe3a:fa8e
    {
      "ipv6_address": "fe80::c62c:3ff:fe3a:fa8e",
      "owner_uuid": "<customer UUID>",
      "belongs_to": "<zone UUID>,
      "nic": "/nics/c4:2c:03:3a:fa:8e"
    }

(An IPv6 address on the same nic as above)


## Reserving a specific IP

For a zone / VM /server:

    PUT /ips/1.2.3.4
      -d status=provisioning,
      -d belongs_to=<zone UUID>


For something else (outside SDC):

    PUT /ips/1.2.3.4
      -d status=reserved


On a Logical Network:

    POST /networks/<uuid>/ips
      -d state=reserved,
      -d owner_uuid=<uuid>
    {
      "address": "4.5.6.7",
      "state": "provisioning",
      "owner_uuid": "<uuid>"
    }


## Provisioning

The 2 ways of provisioning are:

* Provision me the next IP in a subnet - I don't care which one
    * If the customer owns a block of IPs in this subnet, take the next available IP from the IPs they own
* Provision me a specific IP in a subnet - and fail if it's already taken


### Provision an IP

    POST /networks/<uuid>/ips
      -d state=provisioning,
      -d belongs_to=<zone uuid>,
      -d owner_uuid=<uuid>
    {
      "ipv4_address": "4.5.6.7",
      "state": "provisioning",
      "belongs_to": "<zone uuid>",
      "ipv4_netmask": "255.255.255.0",
      // nic / network parameters
      "vlan_id": 62,
      "ipv4_gateway": "<addr>",
      "network": "/networks/<uuid>",
      "nic": "/nics/c4:2c:03:3a:fa:8e",
      "mac": "c4:2c:03:3a:fa:8e",
      "nic_tag": "external"
    }

This:
* Creates a nic as well (shown in the params above)
* Gives all the parameters necessary for provisioning


To reserve an IP with a specific address:

    POST /networks/<uuid>/ips
      -d state=provisioning,
      -d belongs_to=<zone uuid>,
      -d owner_uuid=<uuid>,
      -d ipv4_address=<addr>,
      -d ipv6_address=<addr>
    {
      "ipv4_address": "<addr>",
      "ipv4_netmask": "<netmask>",
      "ipv4_gateway": "<address>",

      "ipv6_address": "<addr>",
      "ipv6_netmask": "<netmask>",
      "ipv6_gateway": "<address>",

      // other parameters as above
    }


### Commit provision

Once the zone has been provisioned successfully, mark the IP as provisioned:

    POST /networks/<uuid>/ips
      -d state=provisioned
    {
      "address": "4.5.6.7",
      "state": "provisioned",
      "owner_uuid": "<uuid>"
    }


### Add a nic to a zone (after it has been provisioned)

This should look like the original nic creation:

    POST /networks/<uuid>/ips
      -d belongs_to=<zone uuid>,
      -d owner_uuid=<uuid>
      -d state=provisioning,
    {
      // params
    }


### Add a nic with antispoof disabled

    POST /networks/<uuid>/ips
      -d belongs_to=<zone uuid>,
      -d owner_uuid=<uuid>,
      -d antispoof_disable=mac,ip
      -d state=provisioning,
    {
      "antispoof_disable": ["mac", "ip"],
      // other params
    }



# IP ownership

To get the list of IPs owned by a customer:

    GET /ips
      -d owner_uuid=<uuid>
    [
      // list of IPs
    ]


To portion out a group of IPs to a customer:

    PUT /networks/<uuid>/ips
      -d owner_uuid=<uuid>,
      -d start_ipv4_address=10.99.99.51,
      -d end_ipv4_address=10.99.99.57,
      -d ipv4_addresses=10.99.99.61,10.99.99.63

The customer with that UUID now owns those IPs (eg: no-one else can provision them)



# VIPs (eg: for Zeus zones)

Provisioning with an IPv4 address and 2 VIPs:

    POST /networks/<uuid>/ips
      -d ipv4_address=<addr>,
      -d ipv4_vip_count=2

Or maybe just:

    POST /networks/<uuid>/ips
      -d ipv4_address_count=3

Add another IP to a nic after it's been created:

    POST /networks/<uuid>/ips
      -d nic=c4:2c:03:3a:fa:8e



# /networks, /nic_tags, /nics, /network_pools

I'm thinking the layout of these could stay pretty much the same as in MAPI, other than:

* cleaning up some inconsistencies
* making them "Cavage scale" by using UUIDs.
* adding owner_uuid to networks

Networks would need changes for IPv6, specifically adding IPv6 attributes:

    GET /networks/<uuid>
    {
      "name": "someNetwork",
      "description": "desc",
      "owner_uuid": "<uuid>",
      "vlan_id": 6,
      // created_at, updated_at, uri omitted
      "ipv4_start_ip": "<ipv4 ip>",
      "ipv4_end_ip": "<ipv4 ip>",
      "ipv4_default_gateway_ip": "<ipv4 ip>",
      "ipv4_subnet": "<ipv4 subnet>",
      "nic_tag": "/nic_tags/<uuid>",
      "ipv4_resolver_ips": [ "<ip1>", "<ip2>" ]

      "ipv6_subnet": "2001:db8:1:2::/64",
      // are start and end ips necessary for IPv6?
      "ipv6_default_gateway_ip": "<ipv6 ip>",
      "ipv6_resolver_ips": [ "<ipv6 ip 1>", "<ipv6 ip 2>" ]
    }

With this model:

* A network can now have IPv4 or IPv6 addresses, or both
* A nic will be given both IPv6 and IPv4 IPs (if both are defined for the LN)


## Alternative layout

We could also do something like this:

    /bridges/<uuid>/logical_networks/<uuid>
    /bridges/<uuid>/network_pools/<uuid>

* *bridges* would be what we now call nic tags (or we could name these "physical networks", or something more descriptive)
* This makes the relationship between nic tags and LNs explicit:
    * LNs are something you create on a bridge. You don't need to have a 1:1 mapping between the two - it's really a 1:n mapping.
    * You can only create network pools with networks on the same bridge

Or:
    /networks/<uuid>/logical/<uuid>
    /networks/<uuid>/pools/<uuid>



# Auditing

Is the UFDS changelog sufficient here?  Or do we require more?

If it's not enough, we could Just use the same endpoints with /audit in front of them, eg:

* /audit/ips/<IPv4 / IPv6 addr>
* /audit/networks/<uuid>
* /audit/nics


# Anti-Spoof

* It must be possible to toggle anti-spoof on / off using an API call for a 
  specific machine. For example, a put to a machine with "mac_antispoof=false",
  would disable anti-spoofing on layer 2. The same must be in place for layer 3.

* This is entirely personal preference, but I'm not entirely keen on a key that
  says "antispoof_disable" which then consists of the values you want to disable.
  I would rather use something explicit like 

    { 
      mac_antispoof: true,
      ip_antispoof: true 
    }

  That way, to change it, you just flip a true/false on a single value, not edit
  an array. 


# Questions / Open Issues

* If a LN has both IPv4 and IPv6 addresses, should we provide the ability to only provision with one or the other?  Or are we always going to want both?
  * Maybe need a way of requesting one or the other only
* Having both IPv4 and IPv6 addresses on the same LN - should we not allow this, and just have the customer create 2 different LNs?
  * Each nic would then only have one address, which is simpler (though you might end up creating way more vnics)
* Should all operations require an owner\_uuid? (I'm thinking yes, even if it's the admin user)
* How to manage other kinds of networks?
* Is the UFDS changelog enough for an audit trail, or do we need more?
* Laying out endpoints like /bridges/<uuid>/logical_networks/<uuid>: does this make things more confusing, or less?
* Should the endpoint for creating IPs on a LN be *POST /networks/<uuid>/nics* (rather than /ips)?
  * This would make it more accurate as to what you're creating - potentially a nic with 2 IPs (one IPv6, one IPv4)
* Should we move from primary networks to primary nics? In practice, it's just one nic that's primary for a zone - the network being "primary" is not really helpful.  This also simplifies things significantly down the stack (eg: with vmadm)



# TODO

* Changing nic tags assigned to a CN should not require rebooting that CN
  for them to actually change

