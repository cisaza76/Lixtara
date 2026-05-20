--
-- PostgreSQL database dump
--

\restrict IlcY9mw6Qu7s8ZRn8kE3apK1hzkxMYN8AeFR8mnu55YxNW20X8xSRcIjtRtLUv8

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'broker',
    'photographer'
);


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  begin
    -- Supabase Auth populates `user_metadata` (new) and/or `raw_user_meta_data`
    -- (legacy) depending on signup flow. Read from both with COALESCE.
    insert into public.users (id, email, first_name, last_name, phone)
    values (
      new.id,
      new.email,
      coalesce(
        new.raw_user_meta_data ->> 'first_name',
        new.raw_user_meta_data ->> 'firstName',
        ''
      ),
      coalesce(
        new.raw_user_meta_data ->> 'last_name',
        new.raw_user_meta_data ->> 'lastName',
        ''
      ),
      coalesce(new.raw_user_meta_data ->> 'phone', '')
    )
    on conflict (id) do nothing;
    return new;
  end;
  $$;


--
-- Name: has_role(public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ 
    select exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = _role
    );
  $$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    transaction_id uuid,
    property_id uuid,
    action_type text NOT NULL,
    description text,
    metadata jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: broker_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broker_tasks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    assigned_to uuid,
    transaction_id uuid,
    property_id uuid,
    task_type text NOT NULL,
    title text NOT NULL,
    description text,
    due_date date,
    priority text DEFAULT 'medium'::text,
    status text DEFAULT 'pending'::text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT broker_tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT broker_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT broker_tasks_task_type_check CHECK ((task_type = ANY (ARRAY['approve_listing'::text, 'review_offer'::text, 'coordinate_closing'::text, 'resolve_issue'::text, 'follow_up'::text])))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    transaction_id uuid,
    property_id uuid,
    document_type text NOT NULL,
    document_name text NOT NULL,
    file_url text NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT documents_document_type_check CHECK ((document_type = ANY (ARRAY['listing_agreement'::text, 'purchase_contract'::text, 'addendum'::text, 'disclosure'::text, 'inspection_report'::text, 'appraisal'::text, 'closing_disclosure'::text, 'deed'::text, 'hoa_docs'::text, 'proof_of_funds'::text, 'other'::text])))
);


--
-- Name: listing_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listing_agreements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    property_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    flat_fee numeric(10,2) DEFAULT 499,
    commission_percentage numeric(4,2) DEFAULT 1.0,
    docusign_envelope_id text,
    signed_at timestamp with time zone,
    signed_pdf_url text,
    status text DEFAULT 'draft'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT listing_agreements_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'signed'::text, 'expired'::text])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    subject text,
    message text NOT NULL,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    failed_at timestamp with time zone,
    failure_reason text,
    related_transaction_id uuid,
    related_property_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['email'::text, 'sms'::text, 'in_app'::text])))
);


--
-- Name: offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    property_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    offer_amount numeric NOT NULL,
    earnest_deposit numeric,
    financing_type text NOT NULL,
    closing_date date,
    expiration_at timestamp with time zone,
    contingencies text[] DEFAULT '{}'::text[],
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    counter_amount numeric,
    counter_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT offers_counter_amount_check CHECK (((counter_amount IS NULL) OR (counter_amount > (0)::numeric))),
    CONSTRAINT offers_earnest_deposit_check CHECK (((earnest_deposit IS NULL) OR (earnest_deposit >= (0)::numeric))),
    CONSTRAINT offers_financing_type_check CHECK ((financing_type = ANY (ARRAY['cash'::text, 'conventional'::text, 'fha'::text, 'va'::text, 'other'::text]))),
    CONSTRAINT offers_offer_amount_check CHECK ((offer_amount > (0)::numeric)),
    CONSTRAINT offers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'countered'::text, 'withdrawn'::text, 'expired'::text])))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    property_id uuid,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD'::text,
    payment_type text NOT NULL,
    stripe_payment_intent_id text,
    stripe_charge_id text,
    stripe_checkout_session_id text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    vendor text DEFAULT 'stripe'::text,
    tier text,
    receipt_url text,
    error_message text,
    completed_at timestamp with time zone,
    CONSTRAINT payments_payment_type_check CHECK ((payment_type = ANY (ARRAY['flat_fee'::text, 'commission'::text, 'refund'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'refunded'::text])))
);


--
-- Name: processed_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor text NOT NULL,
    event_id text NOT NULL,
    event_type text,
    processed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.properties (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    owner_id uuid NOT NULL,
    address_street text NOT NULL,
    address_city text NOT NULL,
    address_state text DEFAULT 'FL'::text,
    address_zip text NOT NULL,
    latitude numeric(10,8),
    longitude numeric(11,8),
    property_type text NOT NULL,
    bedrooms integer,
    bathrooms numeric(3,1),
    sqft integer,
    lot_size numeric(10,2),
    year_built integer,
    list_price numeric(12,2) NOT NULL,
    description text,
    showing_instructions text,
    mls_number text,
    mls_status text DEFAULT 'draft'::text,
    mls_published_at timestamp with time zone,
    mls_expires_at timestamp with time zone,
    buyer_agent_commission numeric(4,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    pricing_tier text,
    price_comps jsonb,
    price_estimate_low integer,
    price_estimate_high integer,
    price_comps_fetched_at timestamp with time zone,
    parking_spaces integer,
    hoa_fee integer,
    tax_annual_amount integer,
    has_pool boolean DEFAULT false,
    cash_only boolean DEFAULT false,
    as_is_sale boolean DEFAULT false,
    flood_zone text,
    occupancy_status text,
    show_phone_on_portals boolean DEFAULT false,
    photos_rights_confirmed boolean DEFAULT false,
    folio text,
    legal_description text,
    CONSTRAINT properties_mls_status_check CHECK ((mls_status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'active'::text, 'under_contract'::text, 'closed'::text, 'expired'::text, 'withdrawn'::text]))),
    CONSTRAINT properties_pricing_tier_check CHECK (((pricing_tier IS NULL) OR (pricing_tier = ANY (ARRAY['essentials'::text, 'pro'::text, 'concierge'::text])))),
    CONSTRAINT properties_property_type_check CHECK ((property_type = ANY (ARRAY['single_family'::text, 'condo'::text, 'townhouse'::text, 'multi_family'::text])))
);


--
-- Name: property_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_photos (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    property_id uuid,
    url text NOT NULL,
    caption text,
    display_order integer DEFAULT 0,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: saved_properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_properties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    property_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tour_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tour_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    property_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    vendor text DEFAULT 'kiri'::text NOT NULL,
    kiri_task_id text,
    status text DEFAULT 'uploading'::text NOT NULL,
    source_video_path text,
    source_video_size_bytes bigint,
    ply_storage_path text,
    ply_size_bytes bigint,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT tour_jobs_status_check CHECK ((status = ANY (ARRAY['uploading'::text, 'queued'::text, 'processing'::text, 'ready'::text, 'failed'::text, 'expired'::text]))),
    CONSTRAINT tour_jobs_vendor_check CHECK ((vendor = 'kiri'::text))
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    property_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    buyer_id uuid,
    purchase_price numeric(12,2) NOT NULL,
    earnest_money numeric(12,2),
    closing_date date,
    title_company_name text,
    title_company_contact text,
    title_company_email text,
    title_order_number text,
    inspection_deadline date,
    financing_deadline date,
    appraisal_deadline date,
    contingency_removal_date date,
    status text DEFAULT 'opened'::text,
    actual_closing_date date,
    closing_disclosure_url text,
    deed_url text,
    nexxos_flat_fee numeric(10,2) DEFAULT 499,
    nexxos_commission numeric(12,2),
    nexxos_co_broke numeric(12,2),
    title_referral_fee numeric(10,2),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT transactions_status_check CHECK ((status = ANY (ARRAY['opened'::text, 'under_contract'::text, 'contingencies_pending'::text, 'clear_to_close'::text, 'closed'::text, 'cancelled'::text])))
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    phone text,
    first_name text,
    last_name text,
    role text DEFAULT 'seller'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['seller'::text, 'buyer'::text, 'broker'::text, 'admin'::text])))
);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: broker_tasks broker_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_tasks
    ADD CONSTRAINT broker_tasks_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: listing_agreements listing_agreements_docusign_envelope_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_agreements
    ADD CONSTRAINT listing_agreements_docusign_envelope_id_key UNIQUE (docusign_envelope_id);


--
-- Name: listing_agreements listing_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_agreements
    ADD CONSTRAINT listing_agreements_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: offers offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_stripe_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);


--
-- Name: processed_webhook_events processed_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_webhook_events
    ADD CONSTRAINT processed_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: processed_webhook_events processed_webhook_events_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_webhook_events
    ADD CONSTRAINT processed_webhook_events_vendor_event_id_key UNIQUE (vendor, event_id);


--
-- Name: properties properties_mls_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_mls_number_key UNIQUE (mls_number);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: property_photos property_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_photos
    ADD CONSTRAINT property_photos_pkey PRIMARY KEY (id);


--
-- Name: saved_properties saved_properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_properties
    ADD CONSTRAINT saved_properties_pkey PRIMARY KEY (id);


--
-- Name: saved_properties saved_properties_user_id_property_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_properties
    ADD CONSTRAINT saved_properties_user_id_property_id_key UNIQUE (user_id, property_id);


--
-- Name: tour_jobs tour_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tour_jobs
    ADD CONSTRAINT tour_jobs_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: offers_buyer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX offers_buyer_id_idx ON public.offers USING btree (buyer_id);


--
-- Name: offers_property_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX offers_property_id_idx ON public.offers USING btree (property_id);


--
-- Name: offers_seller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX offers_seller_id_idx ON public.offers USING btree (seller_id);


--
-- Name: offers_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX offers_status_idx ON public.offers USING btree (status);


--
-- Name: payments_checkout_session_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_checkout_session_uniq ON public.payments USING btree (stripe_checkout_session_id) WHERE (stripe_checkout_session_id IS NOT NULL);


--
-- Name: payments_property_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_property_id_idx ON public.payments USING btree (property_id);


--
-- Name: payments_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_status_idx ON public.payments USING btree (status);


--
-- Name: payments_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_user_id_idx ON public.payments USING btree (user_id);


--
-- Name: properties_folio_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX properties_folio_idx ON public.properties USING btree (folio) WHERE (folio IS NOT NULL);


--
-- Name: saved_properties_property_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_properties_property_id_idx ON public.saved_properties USING btree (property_id);


--
-- Name: saved_properties_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX saved_properties_user_id_idx ON public.saved_properties USING btree (user_id);


--
-- Name: tour_jobs_kiri_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tour_jobs_kiri_task_id_idx ON public.tour_jobs USING btree (kiri_task_id) WHERE (kiri_task_id IS NOT NULL);


--
-- Name: tour_jobs_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tour_jobs_owner_id_idx ON public.tour_jobs USING btree (owner_id);


--
-- Name: tour_jobs_property_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tour_jobs_property_id_idx ON public.tour_jobs USING btree (property_id);


--
-- Name: user_roles_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_roles_user_id_idx ON public.user_roles USING btree (user_id);


--
-- Name: listing_agreements update_listing_agreements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_listing_agreements_updated_at BEFORE UPDATE ON public.listing_agreements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: properties update_properties_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: transactions update_transactions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: activity_log activity_log_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: activity_log activity_log_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: activity_log activity_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: broker_tasks broker_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_tasks
    ADD CONSTRAINT broker_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: broker_tasks broker_tasks_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_tasks
    ADD CONSTRAINT broker_tasks_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: broker_tasks broker_tasks_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_tasks
    ADD CONSTRAINT broker_tasks_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: documents documents_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: documents documents_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: listing_agreements listing_agreements_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_agreements
    ADD CONSTRAINT listing_agreements_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: listing_agreements listing_agreements_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listing_agreements
    ADD CONSTRAINT listing_agreements_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_related_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_related_property_id_fkey FOREIGN KEY (related_property_id) REFERENCES public.properties(id);


--
-- Name: notifications notifications_related_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_related_transaction_id_fkey FOREIGN KEY (related_transaction_id) REFERENCES public.transactions(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: offers offers_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: offers offers_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: offers offers_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: payments payments_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: properties properties_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: property_photos property_photos_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_photos
    ADD CONSTRAINT property_photos_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: saved_properties saved_properties_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_properties
    ADD CONSTRAINT saved_properties_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: saved_properties saved_properties_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_properties
    ADD CONSTRAINT saved_properties_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: tour_jobs tour_jobs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tour_jobs
    ADD CONSTRAINT tour_jobs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: tour_jobs tour_jobs_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tour_jobs
    ADD CONSTRAINT tour_jobs_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id);


--
-- Name: transactions transactions_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: transactions transactions_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id);


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: listing_agreements Brokers can manage all agreements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Brokers can manage all agreements" ON public.listing_agreements USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['broker'::text, 'admin'::text]))))));


--
-- Name: documents Brokers can manage all documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Brokers can manage all documents" ON public.documents USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['broker'::text, 'admin'::text]))))));


--
-- Name: broker_tasks Brokers can manage all tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Brokers can manage all tasks" ON public.broker_tasks USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['broker'::text, 'admin'::text]))))));


--
-- Name: transactions Brokers can manage all transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Brokers can manage all transactions" ON public.transactions USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['broker'::text, 'admin'::text]))))));


--
-- Name: activity_log Brokers can view all activity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Brokers can view all activity" ON public.activity_log FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['broker'::text, 'admin'::text]))))));


--
-- Name: payments Brokers can view all payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Brokers can view all payments" ON public.payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['broker'::text, 'admin'::text]))))));


--
-- Name: properties Brokers can view all properties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Brokers can view all properties" ON public.properties USING ((EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['broker'::text, 'admin'::text]))))));


--
-- Name: transactions Parties can view their transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Parties can view their transactions" ON public.transactions FOR SELECT USING (((auth.uid() = seller_id) OR (auth.uid() = buyer_id)));


--
-- Name: property_photos Public can view active listing photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active listing photos" ON public.property_photos FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.properties
  WHERE ((properties.id = property_photos.property_id) AND (properties.mls_status = 'active'::text)))));


--
-- Name: properties Public can view active listings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active listings" ON public.properties FOR SELECT USING ((mls_status = 'active'::text));


--
-- Name: documents Transaction parties can view documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Transaction parties can view documents" ON public.documents FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.transactions
  WHERE ((transactions.id = documents.transaction_id) AND ((transactions.seller_id = auth.uid()) OR (transactions.buyer_id = auth.uid()))))));


--
-- Name: properties Users can insert own properties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own properties" ON public.properties FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: property_photos Users can manage own property photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own property photos" ON public.property_photos USING ((EXISTS ( SELECT 1
   FROM public.properties
  WHERE ((properties.id = property_photos.property_id) AND (properties.owner_id = auth.uid())))));


--
-- Name: notifications Users can update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: properties Users can update own properties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own properties" ON public.properties FOR UPDATE USING ((auth.uid() = owner_id));


--
-- Name: listing_agreements Users can view own agreements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own agreements" ON public.listing_agreements FOR SELECT USING ((auth.uid() = seller_id));


--
-- Name: notifications Users can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: payments Users can view own payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own payments" ON public.payments FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: properties Users can view own properties; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own properties" ON public.properties FOR SELECT USING ((auth.uid() = owner_id));


--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: broker_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broker_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: listing_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.listing_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

--
-- Name: offers offers seller select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "offers seller select" ON public.offers FOR SELECT USING ((auth.uid() = seller_id));


--
-- Name: offers offers seller update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "offers seller update" ON public.offers FOR UPDATE USING ((auth.uid() = seller_id));


--
-- Name: offers own offers buyer insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own offers buyer insert" ON public.offers FOR INSERT WITH CHECK ((auth.uid() = buyer_id));


--
-- Name: offers own offers buyer select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own offers buyer select" ON public.offers FOR SELECT USING ((auth.uid() = buyer_id));


--
-- Name: offers own offers buyer update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own offers buyer update" ON public.offers FOR UPDATE USING ((auth.uid() = buyer_id));


--
-- Name: payments own payments insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own payments insert" ON public.payments FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: payments own payments select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own payments select" ON public.payments FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_roles own roles select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own roles select" ON public.user_roles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: saved_properties own saves delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own saves delete" ON public.saved_properties FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: saved_properties own saves insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own saves insert" ON public.saved_properties FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: saved_properties own saves select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own saves select" ON public.saved_properties FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: tour_jobs own tour jobs insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own tour jobs insert" ON public.tour_jobs FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: tour_jobs own tour jobs select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own tour jobs select" ON public.tour_jobs FOR SELECT USING ((auth.uid() = owner_id));


--
-- Name: tour_jobs own tour jobs update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own tour jobs update" ON public.tour_jobs FOR UPDATE USING ((auth.uid() = owner_id));


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: processed_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: properties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

--
-- Name: properties properties_public_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY properties_public_read_active ON public.properties FOR SELECT TO authenticated, anon USING ((mls_status = 'active'::text));


--
-- Name: property_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.property_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: property_photos property_photos_public_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY property_photos_public_read_active ON public.property_photos FOR SELECT TO authenticated, anon USING ((EXISTS ( SELECT 1
   FROM public.properties p
  WHERE ((p.id = property_photos.property_id) AND (p.mls_status = 'active'::text)))));


--
-- Name: tour_jobs ready tour jobs public select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ready tour jobs public select" ON public.tour_jobs FOR SELECT USING (((status = 'ready'::text) AND (EXISTS ( SELECT 1
   FROM public.properties p
  WHERE ((p.id = tour_jobs.property_id) AND (p.mls_status = ANY (ARRAY['active'::text, 'pending_approval'::text])))))));


--
-- Name: saved_properties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_properties ENABLE ROW LEVEL SECURITY;

--
-- Name: tour_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tour_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own ON public.users FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));


--
-- Name: users users_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own ON public.users FOR SELECT TO authenticated USING ((auth.uid() = id));


--
-- Name: users users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION has_role(_role public.app_role); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_role(_role public.app_role) TO anon;
GRANT ALL ON FUNCTION public.has_role(_role public.app_role) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(_role public.app_role) TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: TABLE activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activity_log TO anon;
GRANT ALL ON TABLE public.activity_log TO authenticated;
GRANT ALL ON TABLE public.activity_log TO service_role;


--
-- Name: TABLE broker_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.broker_tasks TO anon;
GRANT ALL ON TABLE public.broker_tasks TO authenticated;
GRANT ALL ON TABLE public.broker_tasks TO service_role;


--
-- Name: TABLE documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documents TO anon;
GRANT ALL ON TABLE public.documents TO authenticated;
GRANT ALL ON TABLE public.documents TO service_role;


--
-- Name: TABLE listing_agreements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.listing_agreements TO anon;
GRANT ALL ON TABLE public.listing_agreements TO authenticated;
GRANT ALL ON TABLE public.listing_agreements TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE offers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offers TO anon;
GRANT ALL ON TABLE public.offers TO authenticated;
GRANT ALL ON TABLE public.offers TO service_role;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;


--
-- Name: TABLE processed_webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.processed_webhook_events TO anon;
GRANT ALL ON TABLE public.processed_webhook_events TO authenticated;
GRANT ALL ON TABLE public.processed_webhook_events TO service_role;


--
-- Name: TABLE properties; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.properties TO anon;
GRANT ALL ON TABLE public.properties TO authenticated;
GRANT ALL ON TABLE public.properties TO service_role;


--
-- Name: TABLE property_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.property_photos TO anon;
GRANT ALL ON TABLE public.property_photos TO authenticated;
GRANT ALL ON TABLE public.property_photos TO service_role;


--
-- Name: TABLE saved_properties; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.saved_properties TO anon;
GRANT ALL ON TABLE public.saved_properties TO authenticated;
GRANT ALL ON TABLE public.saved_properties TO service_role;


--
-- Name: TABLE tour_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tour_jobs TO anon;
GRANT ALL ON TABLE public.tour_jobs TO authenticated;
GRANT ALL ON TABLE public.tour_jobs TO service_role;


--
-- Name: TABLE transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transactions TO anon;
GRANT ALL ON TABLE public.transactions TO authenticated;
GRANT ALL ON TABLE public.transactions TO service_role;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict IlcY9mw6Qu7s8ZRn8kE3apK1hzkxMYN8AeFR8mnu55YxNW20X8xSRcIjtRtLUv8

