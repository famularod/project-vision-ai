begin;

drop function if exists public.dave_verify_current_ecos_document_proof(
  text, text, text, text, text, integer, text, text
);

drop function if exists public.ecos_load_project_question_records_v1(
  text, text, integer, integer, integer
);

commit;
