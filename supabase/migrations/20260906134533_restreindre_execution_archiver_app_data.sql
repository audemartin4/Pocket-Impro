-- La fonction n'a de sens qu'appelée par le trigger : personne ne doit pouvoir l'appeler via
-- /rest/v1/rpc (elle est SECURITY DEFINER, autant fermer la porte même si un appel direct
-- échouerait de toute façon — une fonction trigger ne s'appelle pas à la main).
revoke all on function public.archiver_app_data() from public, anon, authenticated;
