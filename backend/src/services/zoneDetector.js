const pool = require("../data/db");

/*
--------------------------------------------------
Load zones and their polygon points for an initiation
--------------------------------------------------
*/
const loadZones = async (initiationId) => {

    const query = `
        SELECT
            z.id AS zone_id,
            z.zone_name,
            zp.point_order,
            zp.x,
            zp.y
        FROM zones z
        JOIN zone_points zp
            ON z.id = zp.zone_id
        WHERE z.initiation_id = $1
        ORDER BY z.id, zp.point_order
    `;

    const result = await pool.query(query, [initiationId]);

    const zonesMap = {};

    result.rows.forEach(row => {

        if (!zonesMap[row.zone_id]) {
            zonesMap[row.zone_id] = {
                zone_name: row.zone_name,
                polygon: []
            };
        }

        zonesMap[row.zone_id].polygon.push({
            x: parseFloat(row.x),
            y: parseFloat(row.y)
        });

    });

    return Object.values(zonesMap);
};


/*
--------------------------------------------------
Point in Polygon (Ray Casting Algorithm)
--------------------------------------------------
*/
const pointInPolygon = (point, polygon) => {

    let x = point.x;
    let y = point.y;

    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {

        let xi = polygon[i].x;
        let yi = polygon[i].y;

        let xj = polygon[j].x;
        let yj = polygon[j].y;

        let intersect =
            ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
};


/*
--------------------------------------------------
Detect zone for given coordinate
--------------------------------------------------
*/
const detectZone = (x, y, zones) => {

    if (x == null || y == null) return null;

    const point = { x, y };

    for (let zone of zones) {

        const inside = pointInPolygon(point, zone.polygon);

        if (inside) {
            return zone.zone_name;
        }
    }

    return null;
};


module.exports = {
    loadZones,
    detectZone
};