const pool = require("../data/db");
const { loadZones, detectZone } = require("./zoneDetector");

const recalculateZones = async (initiationId) => {

    try {

        // 🔹 1. Load all zones for this initiation
        const zones = await loadZones(initiationId);

        if (!zones || zones.length === 0) {
            console.log("No zones defined for initiation:", initiationId);
            return;
        }

        // 🔹 2. Load all tags belonging to this initiation
        const tagQuery = `
            SELECT t.id, t.tag_x, t.tag_y
            FROM tags t
            JOIN uploaded_folders f
            ON t.folder_id = f.id
            WHERE f.initiation_id = $1
        `;

        const tagResult = await pool.query(tagQuery, [initiationId]);

        const tags = tagResult.rows;

        console.log(`Found ${tags.length} tags to process`);

        // 🔹 3. Loop through tags and detect zone
        for (let tag of tags) {

            const zone = detectZone(tag.tag_x, tag.tag_y, zones) || null;

            await pool.query(
                `UPDATE tags
                 SET zone = $1
                 WHERE id = $2`,
                [zone, tag.id]
            );

        }

        console.log("Zone recalculation completed.");

    } catch (error) {

        console.error("Zone recalculation failed:", error);

        throw error;
    }

};

module.exports = recalculateZones;