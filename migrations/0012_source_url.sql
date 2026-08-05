-- Where a game came from, when it did not come from a shop.
--
-- Two thirds of the catalog arrived as crowdfunding pledges, and for those the
-- campaign page is the only authoritative record that exists: BoardGameGeek has
-- no entry for a pledge-tier accessory, and a Kickstarter-exclusive edition is
-- often absent from BGG entirely or listed under a name nobody prints on the
-- box. The campaign page is also the only place a picture of the thing exists.
--
-- publisher_url already holds the publisher's own site. This is deliberately a
-- separate column: the two answer different questions ("who makes this" versus
-- "where did I get this"), and a game can have both.

ALTER TABLE item ADD COLUMN source_url TEXT;
