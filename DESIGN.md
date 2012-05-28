# NAPI - Network API Feedback

### The Model

In the model the URI contains the IP address, but in theory there is no reason
why we couldn't have multiple IP address ranges overlap within an environment.
For example, if we used VL2 or VXLAN, every single customer could have a
10.0.0.0/8 address range to themselves. While I doubt we'd see that in
production, the value of network virtualization goes away if we can't have those
overlaps. This implies that /ips/10.0.0.1 *could* have multiple records.

Perhaps having them scoped by "Network" or "LogicalNetwork" ?

Subnet declaration seems to be missing. That should be okay, but you need to
reference the subnet URI at least. Someone should be able to query an IP address
and figure out what Logical Network and Subnet they belong to. In fact, you will
probably need that too, for the FWAPI. ;)

Will NAPI expose NICS?


### States

There is a mini state machine in here with the "provisioning" "reserved"
"provisioned" and "free" states. Why have more than "reserved" or "free" ? 
A reservation implies that the IP address is in use, and we'll also have to have
an API call that will let us do reporting, like:
 * "what CN does this IP map to"
 * "what VM does this IP map to"
 * "who currently owns this IP"

No IP should be "reserved" w/o an owner, but they could be reserved and not
belong to a CN or an IP.


### NAT and IPv4 <-> IPv6 Mapping

It may be worthwhile having a property on IP addresses that lets us record a NAT
or IPv4 IPv6 mapping. This way, we could say "IP address fe80:1 is mapped to
192.168.0.1"

### The Query Mechanism

What is the provision list?
Is this a list of all ips in the state "provisioned"

### Provisioning

Again, see my "states" notes above. 
For provisioning we may just want to reserve the IP address - seeing as
reservations will probably have to be associated to owners anyway, you can skip
a step.

The "next ip in the subnet" is tricky. We may want to choose random free IP
addresses instead. The reason for this was because of the stale ARP issue we ran
into before. If someone releases an IP and then it gets used immediately, other
systems ARP caches will be stale. If the OS doesnt send out gratuitious arps the
way its supposed to, then we can run into a problem. Possible fix here is to
have the hypervisor send out the gratuitous arps in behalf of the vm.

The "provisioning an IP" parameters will probably need to include more
information, like DNS servers, search domain, etc. Or will they?

### VIPS

Oddly enough, every single IP address in our stack is a "virtual" IP address,
but the major difference is that it may belong to one or more machines. In the
scenario where I'm using a VIP, I probably want to specify the IP address too -
especially if I'm using it in a load balancing or HA situation.

So for a VIP, it's just a reserved IP address that can belong to one or more
machines (belongs_to in that case is an array). The antispoof rules
would have to include all possible VIPs that belong to a machine, OR you would
have to have an explicit API call you have to make to move the IP address over.
Warrants quite a bit more discussion

### IP Assignment

In your logical network model it says "a nic will be given both ipv4 and ipv6 if
the logical network has them". But, a LN will run out of IPV4 addresses long
before it runs out of IPV6 addresses. How will it work then? Just assign an
IPv6, or fail if the reservation can't continue if you requested IPv4?

### DNS Names

It should be possible to associate a DNS name with an IP address. Each "address"
resource in NAPI should also have an optional `dnsName` (or similar) key that
can contain a valid hostname. This is so we can display an IP address in
hostname format. 

### Bridges / Networks / TAGS

Tags arent really bridges. Tags are just telling CNs what physical link a
logical network traffic needs to flow over. The issue with calling it bridge is
that bridge becomes ambiguous because "is it a bridge for customer data or for
encapsulated data"? I'm not attached to tags in any way, though.

### Auditing 

Short answer is the UFDS changelog is probably sufficient, in combination with
some kind of remote logging. Dont worry too much about persistent reports. 

### Questions and Open Issues

* Provision with IPv4 and IPv6 or one or the other:

Ahh I asked this earlier, too. What if it was up to the provisioning request to
determine whether or not an IP was granted? IOW, if I *need* an IPv4 address,
then attempt to reserve one. If I cannot, then the provision cannot succeed, and
I bail. It would be tricky for NAPI to know about such logic - I would say "Just
let someone reserve whatever they ask for".

* Do we need a way of requesting one or the other? Both?

Yes, absolutely - we need to make it possible to request either an ipv4 or an
ipv6 address, or both. It is totally realistic for us to give every single
machine an IPv6 address and do 6 in 4 translation or what have you, to some
external IP address on a NAT device, or to run in dual-stack for awhile.
Long-term, we'll probably end up IPv6 only (2-3 years)

* IPv4 IPv6 dual mode for logical networks?

Yes, absolutely both stacks on the same LN.

* Do all operations require an owner?

I would vote yes, with a UUID of all zeroes indicating local admin.

* How do we manage other kinds of networks?

It seems as though the networks model will have to have "types", similar to the
way the machines.json model behaves. It's impossible to say how different they
will be, so planning ahead may be tricky. That being said, it would be up to an
external program from NAPI to do things like VXLAN or VL2, etc - so it may be
less of an issue.

* Is UFDS enough for auditing?

Yes, for now.

* API Naming fo bridges vs networks?

See above

* Primary NIC vs Primary Network

Its implied that the primary NIC is the first nic on the system, or at least -
whichever one is being used as the default gateway. 
