SELECT category, COUNT(*) FILTER (WHERE is_active) AS activos, 
       COUNT(*) FILTER (WHERE NOT is_active) AS inactivos
FROM award_candidates
GROUP BY category;